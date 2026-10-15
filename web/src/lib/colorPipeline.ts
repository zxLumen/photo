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
 * 调色管线(预览与导出共用同一套 shader,保证「所见即所得」)。
 *
 * 设计要点(相对早期版本的关键改进):
 *  1. **曝光 / 白平衡在线性光里做** —— sRGB 是 gamma 编码的,直接乘会偏色、发灰;
 *     先解码到线性、调完再编码回去,颜色才准。
 *  2. **明暗分区(高光/阴影/白/黑)用「乘性」而非「加性」** —— 加性会把画面推向
 *     中灰、发白(所谓「漂白」),乘性只按亮度分区缩放,不会污染整体。
 *  3. **对比度用 S 曲线** —— smoothstep 天然在两端压平,等于自带高光/暗部滚降,
 *     提反差的同时不炸高光。
 *  4. **参数全为零时严格等于原图** —— `u_identity` 直接输出采样色,保证「修前」
 *     对照是真正的原始画面,且调节过程中不会出现跳变。
 */
const FRAG = `
precision highp float;
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

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

float luma(vec3 c) { return dot(c, LUMA); }

/* sRGB <-> 线性光 */
vec3 srgb2lin(vec3 c) {
  vec3 lo = c / 12.92;
  vec3 hi = pow(max(c + 0.055, 0.0) / 1.055, vec3(2.4));
  return mix(lo, hi, step(vec3(0.04045), c));
}
vec3 lin2srgb(vec3 c) {
  c = max(c, 0.0);
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

/* 5 抽头十字模糊(用于降噪 / 清晰度 / 锐化的差分) */
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

  // 无任何调整 → 原样输出(保证「修前」对照精确,也省一次完整计算)
  if (u_identity > 0.5) {
    gl_FragColor = vec4(c, 1.0);
    return;
  }

  // 降噪(感知空间,轻度)
  if (u_denoise > 0.001) c = mix(c, blur3(v_uv), u_denoise / 100.0 * 0.8);

  // ---- 线性光:白平衡 + 曝光 ----
  vec3 lin = srgb2lin(c);

  float t = u_temperature / 100.0;
  float ti = u_tint / 100.0;
  lin.r *= 1.0 + t * 0.32 + ti * 0.06;
  lin.b *= 1.0 - t * 0.32 + ti * 0.06;
  lin.g *= 1.0 - ti * 0.22;

  lin *= exp2(u_exposure / 100.0 * 1.5);   // ±1.5 EV

  // ---- 回到感知空间,做乘性明暗分区 ----
  vec3 p = lin2srgb(lin);
  float l = luma(p);

  float mh = smoothstep(0.45, 1.00, l);      // 高光
  float ms = 1.0 - smoothstep(0.00, 0.55, l); // 阴影
  float mw = smoothstep(0.70, 1.00, l);      // 白场
  float mb = 1.0 - smoothstep(0.00, 0.30, l); // 黑场

  p *= 1.0 + (u_highlights / 100.0) * 0.45 * mh;
  p *= 1.0 + (u_shadows / 100.0) * 0.55 * ms;
  p *= 1.0 + (u_whites / 100.0) * 0.30 * mw;
  p *= 1.0 + (u_blacks / 100.0) * 0.60 * mb;

  // 对比度:S 曲线
  float kc = u_contrast / 100.0;
  if (kc > 0.0) {
    vec3 s = p * p * (3.0 - 2.0 * p);
    p = mix(p, s, min(kc, 1.0) * 0.92);
  } else if (kc < 0.0) {
    p = mix(p, 0.5 + (p - 0.5) * 0.62, min(-kc, 1.0));
  }

  // 清晰度(中间调局部对比)+ 锐化(细节)
  float kcl = u_clarity / 100.0;
  float ksh = u_sharpen / 100.0;
  if (abs(kcl) > 0.001 || ksh > 0.001) {
    vec3 detail = p - blur3(v_uv);
    float mid = 1.0 - abs(2.0 * luma(p) - 1.0);
    p += detail * (kcl * 1.5 * (0.35 + 0.65 * mid) + ksh * 1.15);
  }

  // 饱和度 + 自然饱和度
  p = mix(vec3(luma(p)), p, 1.0 + u_saturation / 100.0);
  float mx = max(p.r, max(p.g, p.b));
  float mn = min(p.r, min(p.g, p.b));
  float sat = clamp(mx - mn, 0.0, 1.0);
  p = mix(vec3(luma(p)), p, 1.0 + (u_vibrance / 100.0) * (1.0 - sat) * 1.3);

  // 暗角
  if (abs(u_vignette) > 0.001) {
    vec2 d = v_uv - 0.5;
    float r = length(d) * 1.4142136;
    p *= 1.0 + smoothstep(0.45, 1.1, r) * (u_vignette / 100.0) * 0.85;
  }

  gl_FragColor = vec4(clamp(p, 0.0, 1.0), 1.0);
}
`

/** 调色 shader 编译/链接失败时的兜底:只把纹理画出来(不调色),保证不黑屏 */
const PASSTHROUGH_FRAG = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_image;
void main() { gl_FragColor = texture2D(u_image, v_uv); }
`

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type)
  if (!sh) return null
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh)
    return null
  }
  return sh
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

/**
 * 基于 WebGL 的实时调色管线(非破坏,预览与导出共用同一套 shader)。
 * 不可用时 `supported=false`,调用方退回「仅几何、不调色」。
 */
export class ColorRenderer {
  readonly supported: boolean
  /** 调色 shader 是否可用(不可用则只显示原图) */
  private graded = false
  private gl: WebGLRenderingContext | null = null
  private program: WebGLProgram | null = null
  private texture: WebGLTexture | null = null
  private buf: WebGLBuffer | null = null
  private u: Partial<Record<(typeof UNIFORM_NAMES)[number], WebGLUniformLocation | null>> = {}

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false }) as WebGLRenderingContext | null
    if (!gl) {
      this.supported = false
      return
    }
    this.gl = gl
    const vs = compile(gl, gl.VERTEX_SHADER, VERT)
    if (!vs) {
      this.supported = false
      return
    }
    // 优先用完整调色 shader;失败则退回「只显示、不调色」的直通 shader ——
    // 因为 canvas 一旦绑定了 WebGL 上下文就无法再取 2D 上下文,调用方的 2D 兜底会失效而整片黑屏。
    let fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
    this.graded = !!fs
    if (!fs) fs = compile(gl, gl.FRAGMENT_SHADER, PASSTHROUGH_FRAG)
    if (!fs) {
      this.supported = false
      return
    }
    const prog = gl.createProgram()
    if (!prog) {
      this.supported = false
      return
    }
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      this.supported = false
      return
    }
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
    const g = (v: number) => v / 100
    gl.useProgram(this.program)
    if (this.graded) {
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
