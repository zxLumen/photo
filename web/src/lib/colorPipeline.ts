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
 * 设计要点:
 *  1. **曝光 / 白平衡在线性光里做**(sRGB 是 gamma 编码,直接乘会偏色发灰);
 *  2. **高光/阴影/白/黑用乘性分区**(加性会把画面推向中灰、漂白);
 *  3. **对比度用 S 曲线**(自带高光/暗部滚降,提反差也不炸高光);
 *  4. **参数全为零时严格等于原图**(`u_identity`);
 *  5. **只用标量函数 + 三元表达式**写 GLSL —— 避开部分驱动对 vec3 重载
 *     (`max(vec3,float)` / `mix(vec3,vec3,vec3)`)支持不佳导致的编译失败。
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

/* sRGB <-> 线性光(逐通道标量,最保守的写法) */
float s2l(float v) { return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4); }
float l2s(float v) {
  float x = v < 0.0 ? 0.0 : v;
  return x <= 0.0031308 ? x * 12.92 : 1.055 * pow(x, 0.41666667) - 0.055;
}
vec3 s2l3(vec3 c) { return vec3(s2l(c.r), s2l(c.g), s2l(c.b)); }
vec3 l2s3(vec3 c) { return vec3(l2s(c.r), l2s(c.g), l2s(c.b)); }

/* 5 抽头十字模糊(降噪 / 清晰度 / 锐化的差分) */
vec3 blur3(vec2 uv) {
  vec3 s = texture2D(u_image, uv).rgb * 0.3333333;
  s += texture2D(u_image, uv + vec2(u_texel.x, 0.0)).rgb * 0.1666667;
  s += texture2D(u_image, uv - vec2(u_texel.x, 0.0)).rgb * 0.1666667;
  s += texture2D(u_image, uv + vec2(0.0, u_texel.y)).rgb * 0.1666667;
  s += texture2D(u_image, uv - vec2(0.0, u_texel.y)).rgb * 0.1666667;
  return s;
}

void main() {
  vec3 c = texture2D(u_image, v_uv).rgb;
  vec3 outC = c;

  if (u_identity < 0.5) {
    if (u_denoise > 0.001) c = mix(c, blur3(v_uv), u_denoise * 0.8);

    /* ---- 线性光:白平衡 + 曝光 ---- */
    vec3 lin = s2l3(c);
    float t = u_temperature;
    float ti = u_tint;
    lin.r *= 1.0 + t * 0.32 + ti * 0.06;
    lin.b *= 1.0 - t * 0.32 + ti * 0.06;
    lin.g *= 1.0 - ti * 0.22;
    lin *= pow(2.0, u_exposure * 1.5);   /* u_exposure 已在 JS 里 /100(±1),故 ±1.5 EV */

    /* ---- 感知空间:乘性明暗分区 ---- */
    vec3 p = l2s3(lin);
    float l = luma(p);
    float mh = smoothstep(0.45, 1.00, l);
    float ms = 1.0 - smoothstep(0.00, 0.55, l);
    float mw = smoothstep(0.70, 1.00, l);
    float mb = 1.0 - smoothstep(0.00, 0.30, l);
    p *= 1.0 + u_highlights * 0.45 * mh;
    p *= 1.0 + u_shadows * 0.55 * ms;
    p *= 1.0 + u_whites * 0.30 * mw;
    p *= 1.0 + u_blacks * 0.60 * mb;

    /* ---- 对比度:S 曲线 ---- */
    float kc = u_contrast;
    if (kc > 0.0) {
      vec3 s = p * p * (3.0 - 2.0 * p);
      float a = kc > 1.0 ? 1.0 : kc;
      p = mix(p, s, a * 0.92);
    } else {
      float a = kc < -1.0 ? 1.0 : -kc;
      p = mix(p, vec3(0.5, 0.5, 0.5) + (p - vec3(0.5, 0.5, 0.5)) * 0.62, a);
    }

    /* ---- 清晰度 + 锐化 ---- */
    float kcl = u_clarity;
    float ksh = u_sharpen;
    if (kcl > 0.001 || kcl < -0.001 || ksh > 0.001) {
      vec3 detail = p - blur3(v_uv);
      float mid = 1.0 - abs(2.0 * luma(p) - 1.0);
      p += detail * (kcl * 1.5 * (0.35 + 0.65 * mid) + ksh * 1.15);
    }

    /* ---- 饱和度 + 自然饱和度 ---- */
    float lum = luma(p);
    p = mix(vec3(lum, lum, lum), p, 1.0 + u_saturation);
    float mx = max(p.r, max(p.g, p.b));
    float mn = min(p.r, min(p.g, p.b));
    float sat = mx - mn;
    float vk = 1.0 + u_vibrance * (1.0 - sat) * 1.3;
    float lum2 = luma(p);
    p = mix(vec3(lum2, lum2, lum2), p, vk);

    /* ---- 暗角 ---- */
    if (u_vignette > 0.001 || u_vignette < -0.001) {
      vec2 d = v_uv - vec2(0.5, 0.5);
      float r = length(d) * 1.4142136;
      p *= 1.0 + smoothstep(0.45, 1.1, r) * u_vignette * 0.85;
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
      if (graded) {
        // 链接失败:再试一次直通,尽量保证能显示
        const pt = compile(gl, gl.FRAGMENT_SHADER, passthroughSrc(prec)).shader
        if (pt) {
          const p2 = gl.createProgram()
          if (p2) {
            gl.attachShader(p2, vs)
            gl.attachShader(p2, pt)
            gl.linkProgram(p2)
            if (gl.getProgramParameter(p2, gl.LINK_STATUS)) {
              this.graded = false
              this.errorLog = log || '调色程序链接失败'
              this.finishInit(gl, p2)
              return
            }
          }
        }
      }
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
