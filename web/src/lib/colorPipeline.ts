import type { ToneParams } from '../types.js'

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

/**
 * 调色管线(预览与导出共用同一套 shader)。
 *
 * 相比早期版本的几处**关键升级**(都是「显丑」的根源):
 *  1. **亮度域 filmic 色调曲线**:把曝光、对比、高光、阴影、白、黑统一到
 *     「以中灰 0.18 为原点的 log2 亮度」上做位移与拉伸,高光再过一道**软肩**
 *     (shoulder)→ 提反差/提亮时高光是**平滑压回**而不是断崖剪裁。
 *  2. **OKLab 彩度**:饱和/自然饱和度在感知均匀空间里缩放色度(a,b),
 *     只改彩度、不动色相,并避免 RGB 混亮带来的过冲偏色。
 *  3. **色域软限位**:超出 [0,1] 时先整体回缩、再朝亮度去饱和,
 *     而不是末尾硬 `clamp`(硬夹会直接改色相)。
 *  4. **9 抽头模糊 + 限幅锐化**:锐化/清晰度用 3x3 高斯差分,并压低强度,
 *     少出白边光晕。
 *  5. **参数全为零时严格等于原图**(`u_identity`)。
 *
 * 全部用标量函数 + 三元表达式书写,避开部分驱动对 vec3 重载支持不佳的问题。
 */
function fragSrc(precision: string): string {
  return `
precision ${precision} float;
varying vec2 v_uv;
uniform sampler2D u_image;
uniform vec2 u_texel;
uniform float u_identity;
uniform float u_exposure;
uniform float u_contrast;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_whites;
uniform float u_blacks;
uniform float u_temperature;
uniform float u_tint;
uniform float u_vibrance;
uniform float u_saturation;
uniform float u_clarity;
uniform float u_sharpen;
uniform float u_denoise;
uniform float u_vignette;

float luma(vec3 c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

/* sRGB <-> 线性光(逐通道标量) */
float s2l(float v) { return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4); }
float l2s(float v) {
  float x = v < 0.0 ? 0.0 : v;
  return x <= 0.0031308 ? x * 12.92 : 1.055 * pow(x, 0.41666667) - 0.055;
}
vec3 s2l3(vec3 c) { return vec3(s2l(c.r), s2l(c.g), s2l(c.b)); }
vec3 l2s3(vec3 c) { return vec3(l2s(c.r), l2s(c.g), l2s(c.b)); }

/* 线性 sRGB <-> OKLab(感知均匀,用于只改彩度不偏色) */
vec3 lin2oklab(vec3 c) {
  float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  float l_ = pow(max(l, 0.0), 0.3333333);
  float m_ = pow(max(m, 0.0), 0.3333333);
  float s_ = pow(max(s, 0.0), 0.3333333);
  return vec3(
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_);
}
vec3 oklab2lin(vec3 lab) {
  float l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  float l = l_ * l_ * l_;
  float m = m_ * m_ * m_;
  float s = s_ * s_ * s_;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}

/* 3x3 高斯(9 抽头),用于降噪 / 清晰度 / 锐化的差分 */
vec3 blur9(vec2 uv) {
  vec3 s = texture2D(u_image, uv).rgb * 0.25;
  s += texture2D(u_image, uv + vec2(u_texel.x, 0.0)).rgb * 0.125;
  s += texture2D(u_image, uv - vec2(u_texel.x, 0.0)).rgb * 0.125;
  s += texture2D(u_image, uv + vec2(0.0, u_texel.y)).rgb * 0.125;
  s += texture2D(u_image, uv - vec2(0.0, u_texel.y)).rgb * 0.125;
  s += texture2D(u_image, uv + u_texel).rgb * 0.0625;
  s += texture2D(u_image, uv - u_texel).rgb * 0.0625;
  s += texture2D(u_image, uv + vec2(u_texel.x, -u_texel.y)).rgb * 0.0625;
  s += texture2D(u_image, uv + vec2(-u_texel.x, u_texel.y)).rgb * 0.0625;
  return s;
}

/* 软肩:x<=knee 恒等,x>knee 平滑压向 1(高光滚降,永不断崖) */
float shoulder(float x, float knee) {
  return x <= knee ? x : knee + (1.0 - knee) * (1.0 - exp(-(x - knee) / max(1.0 - knee, 1e-4)));
}

/* 高斯权重(自己平方,避免 pow(负数)) */
float gw(float d, float c, float s) {
  float t = (d - c) / s;
  return exp(-t * t);
}

void main() {
  vec3 src = texture2D(u_image, v_uv).rgb;
  vec3 outC = src;

  if (u_identity < 0.5) {
    /* ---- 1. 线性光:降噪 → 白平衡 → 曝光 ---- */
    vec3 c = src;
    if (u_denoise > 0.001) c = mix(c, blur9(v_uv), u_denoise * 0.7);

    vec3 lin = s2l3(c);
    float t = u_temperature;
    float ti = u_tint;
    lin.r *= 1.0 + t * 0.30 + ti * 0.06;
    lin.b *= 1.0 - t * 0.30 + ti * 0.06;
    lin.g *= 1.0 - ti * 0.20;
    lin *= pow(2.0, u_exposure * 1.4);   /* u_exposure 已在 JS 里 /100(±1)→ ±1.4EV */

    /* ---- 2. 亮度域色调曲线(以中灰 0.18 为原点的 log2 亮度)---- */
    float l = max(luma(lin), 1e-4);
    float mid = -2.4739312;              /* log2(0.18) */
    float d = log2(l) - mid;             /* 相对中灰的曝光级数(stops) */

    float wSh = gw(d, -2.2, 1.5);
    float wHi = gw(d, 1.6, 1.5);
    float wBl = gw(d, -3.4, 1.0);
    float wWh = gw(d, 2.8, 1.0);

    float dd = d;
    dd += u_shadows * 0.75 * wSh;
    dd += u_highlights * 0.75 * wHi;     /* 高光取负 = 压高光 */
    dd += u_blacks * 0.75 * wBl;         /* 黑取负 = 压暗黑场 */
    dd += u_whites * 0.75 * wWh;
    dd *= 1.0 + u_contrast * 0.7;        /* 对比 = log 域拉伸 */

    float l2 = shoulder(pow(2.0, mid + dd), 0.82);
    lin *= l2 / l;

    /* ---- 3. OKLab 彩度:只改彩度、不动色相 ---- */
    vec3 lab = lin2oklab(lin);
    float chroma = length(lab.yz);
    float vibK = 1.0 + u_vibrance * max(0.0, 1.0 - chroma / 0.22) * 0.9;
    lab.yz *= (1.0 + u_saturation) * vibK;
    lin = oklab2lin(lab);

    /* ---- 4. 色域软限位(超界先回缩,再朝亮度去饱和)---- */
    float mx = max(lin.r, max(lin.g, lin.b));
    if (mx > 1.0) lin *= shoulder(mx, 0.9) / mx;
    float mn = min(lin.r, min(lin.g, lin.b));
    float gy = luma(lin);
    if (mn < 0.0 && gy > 1e-5) lin = mix(vec3(gy, gy, gy), lin, clamp(gy / (gy - mn), 0.0, 1.0));

    /* ---- 5. 回显示空间:清晰度 / 锐化 / 暗角 ---- */
    vec3 p = l2s3(lin);
    float kcl = u_clarity;
    float ksh = u_sharpen;
    if (kcl > 0.001 || kcl < -0.001 || ksh > 0.001) {
      vec3 detail = p - blur9(v_uv);
      float mid2 = 1.0 - abs(2.0 * luma(p) - 1.0);
      p += detail * (kcl * 1.1 * (0.3 + 0.7 * mid2) + ksh * 0.75);
    }

    if (u_vignette > 0.001 || u_vignette < -0.001) {
      vec2 dv = v_uv - vec2(0.5, 0.5);
      float rr = length(dv) * 1.4142136;
      p *= 1.0 + smoothstep(0.5, 1.15, rr) * u_vignette * 0.7;
    }

    outC = p;
  }

  gl_FragColor = vec4(clamp(outC, 0.0, 1.0), 1.0);
}
`
}

/** 调色 shader 失败时的兜底:只把纹理画出来(不调色) */
function passthroughSrc(precision: string): string {
  return `
precision ${precision} float;
varying vec2 v_uv;
uniform sampler2D u_image;
void main() { gl_FragColor = texture2D(u_image, v_uv); }
`
}

function compile(gl: WebGLRenderingContext, type: number, src: string): { shader: WebGLShader | null; log: string } {
  const sh = gl.createShader(type)
  if (!sh) return { shader: null, log: 'createShader 失败' }
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || '未知编译错误'
    gl.deleteShader(sh)
    return { shader: null, log }
  }
  return { shader: sh, log: '' }
}

const UNIFORM_NAMES = [
  'u_image',
  'u_texel',
  'u_identity',
  'u_exposure',
  'u_contrast',
  'u_highlights',
  'u_shadows',
  'u_whites',
  'u_blacks',
  'u_temperature',
  'u_tint',
  'u_vibrance',
  'u_saturation',
  'u_clarity',
  'u_sharpen',
  'u_denoise',
  'u_vignette',
] as const

const TONE_KEYS = [
  'exposure',
  'contrast',
  'highlights',
  'shadows',
  'whites',
  'blacks',
  'temperature',
  'tint',
  'vibrance',
  'saturation',
  'clarity',
  'sharpen',
  'denoise',
  'vignette',
] as const

/** 全为零 → 恒等(原图);否则走完整管线 */
function isIdentity(tone: ToneParams): boolean {
  for (const k of TONE_KEYS) if (tone[k]) return false
  return true
}

/** 片元着色器精度:优先 highp,不支持则退回 mediump(部分老设备/移动 GPU) */
function fragPrecision(gl: WebGLRenderingContext): string {
  try {
    const f = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)
    if (f && f.precision > 0) return 'highp'
  } catch {
    /* ignore */
  }
  return 'mediump'
}

export interface ColorSupport {
  webgl: boolean
  /** 能否真正调色(false = 只能显示原图,调色不可用) */
  graded: boolean
  /** 编译失败时的驱动日志(用于排查) */
  log: string
}

/**
 * 基于 WebGL 的实时调色管线(非破坏,预览与导出共用同一套 shader)。
 * 不可用时 `supported=false`,调用方退回「仅几何、不调色」。
 */
export class ColorRenderer {
  supported: boolean
  /** 调色 shader 是否可用(不可用则只显示原图) */
  graded: boolean
  readonly errorLog: string
  private gl: WebGLRenderingContext | null = null
  private program: WebGLProgram | null = null
  private texture: WebGLTexture | null = null
  private buf: WebGLBuffer | null = null
  private u: Partial<Record<(typeof UNIFORM_NAMES)[number], WebGLUniformLocation | null>> = {}

  constructor(private canvas: HTMLCanvasElement) {
    this.supported = false
    this.graded = false
    this.errorLog = ''

    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false }) as WebGLRenderingContext | null
    if (!gl) return
    this.gl = gl

    const prec = fragPrecision(gl)
    const vs = compile(gl, gl.VERTEX_SHADER, VERT).shader
    if (!vs) return

    // 先试完整调色 shader;失败退回直通(只显示、不调色),避免整片黑屏。
    let log = ''
    let fsRes = compile(gl, gl.FRAGMENT_SHADER, fragSrc(prec))
    let graded = !!fsRes.shader
    if (!graded) {
      log = fsRes.log
      fsRes = compile(gl, gl.FRAGMENT_SHADER, passthroughSrc(prec))
    }
    const fs = fsRes.shader
    if (!fs) return

    const prog = gl.createProgram()
    if (!prog) return
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      return
    }

    this.graded = graded
    this.errorLog = graded ? '' : log || '调色 shader 不可用'
    this.finishInit(gl, prog)
  }

  private finishInit(gl: WebGLRenderingContext, prog: WebGLProgram): void {
    this.program = prog
    gl.useProgram(prog)

    this.buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    this.texture = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

    for (const name of UNIFORM_NAMES) this.u[name] = gl.getUniformLocation(prog, name)
    gl.uniform1i(this.u.u_image ?? null, 0)
    this.supported = true
  }

  /** 上传源图(2D canvas / ImageBitmap / Image)。会按源尺寸调整画布。 */
  setSource(source: TexImageSource, width: number, height: number): void {
    const gl = this.gl
    if (!gl || !this.texture) return
    if (this.program) gl.useProgram(this.program)
    this.canvas.width = width
    this.canvas.height = height
    gl.viewport(0, 0, width, height)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    gl.uniform2f(this.u.u_texel ?? null, 1 / Math.max(1, width), 1 / Math.max(1, height))
  }

  render(tone: ToneParams): void {
    const gl = this.gl
    if (!gl || !this.program) return
    gl.useProgram(this.program)
    if (this.graded) {
      const g = (v: number) => v / 100
      gl.uniform1f(this.u.u_identity ?? null, isIdentity(tone) ? 1 : 0)
      gl.uniform1f(this.u.u_exposure ?? null, g(tone.exposure))
      gl.uniform1f(this.u.u_contrast ?? null, g(tone.contrast))
      gl.uniform1f(this.u.u_highlights ?? null, g(tone.highlights))
      gl.uniform1f(this.u.u_shadows ?? null, g(tone.shadows))
      gl.uniform1f(this.u.u_whites ?? null, g(tone.whites))
      gl.uniform1f(this.u.u_blacks ?? null, g(tone.blacks))
      gl.uniform1f(this.u.u_temperature ?? null, g(tone.temperature))
      gl.uniform1f(this.u.u_tint ?? null, g(tone.tint))
      gl.uniform1f(this.u.u_vibrance ?? null, g(tone.vibrance))
      gl.uniform1f(this.u.u_saturation ?? null, g(tone.saturation))
      gl.uniform1f(this.u.u_clarity ?? null, g(tone.clarity))
      gl.uniform1f(this.u.u_sharpen ?? null, g(tone.sharpen))
      gl.uniform1f(this.u.u_denoise ?? null, g(tone.denoise))
      gl.uniform1f(this.u.u_vignette ?? null, g(tone.vignette))
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  dispose(): void {
    const gl = this.gl
    if (!gl) return
    if (this.texture) gl.deleteTexture(this.texture)
    if (this.buf) gl.deleteBuffer(this.buf)
    if (this.program) gl.deleteProgram(this.program)
  }
}

/** 探测当前浏览器是否能启用调色(离屏试编译一次,拿到驱动日志) */
export function detectColorSupport(): ColorSupport {
  if (typeof document === 'undefined') return { webgl: false, graded: false, log: '' }
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 4
  const r = new ColorRenderer(canvas)
  const out: ColorSupport = { webgl: r.supported, graded: r.graded, log: r.errorLog }
  r.dispose()
  return out
}
