import type { ToneParams } from '../types.js'

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

const FRAG = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_image;
uniform vec2 u_texel;
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

vec3 blur3(vec2 uv) {
  vec3 s = texture2D(u_image, uv).rgb * 0.3333333;
  s += texture2D(u_image, uv + vec2(u_texel.x, 0.0)).rgb * 0.1666667;
  s += texture2D(u_image, uv - vec2(u_texel.x, 0.0)).rgb * 0.1666667;
  s += texture2D(u_image, uv + vec2(0.0, u_texel.y)).rgb * 0.1666667;
  s += texture2D(u_image, uv - vec2(0.0, u_texel.y)).rgb * 0.1666667;
  return s;
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec3 c = texture2D(u_image, v_uv).rgb;

  if (u_denoise > 0.001) {
    c = mix(c, blur3(v_uv), u_denoise * 0.7);
  }

  // 曝光:±1 EV
  c *= pow(2.0, u_exposure);

  // 白平衡:色温(暖/冷)+ 色调(品红/绿)
  c.r *= 1.0 + u_temperature * 0.28;
  c.b *= 1.0 - u_temperature * 0.28;
  float mg = max(u_tint, 0.0);
  float gr = max(-u_tint, 0.0);
  c.r *= 1.0 + mg * 0.12;
  c.b *= 1.0 + mg * 0.12;
  c.g *= 1.0 + gr * 0.2;

  float l = luma(c);
  float hi = smoothstep(0.5, 1.0, l);
  float sh = 1.0 - smoothstep(0.0, 0.5, l);
  c += u_highlights * 0.35 * hi;
  c += u_shadows * 0.35 * sh;

  float l2 = luma(c);
  c += u_whites * 0.25 * smoothstep(0.6, 1.0, l2);
  c += u_blacks * 0.25 * (1.0 - smoothstep(0.0, 0.4, l2));

  // 对比(绕 0.5 拉伸)
  c = (c - 0.5) * (1.0 + u_contrast * 1.2) + 0.5;

  // 清晰度 / 锐化(与模糊做差分)
  if (abs(u_clarity) > 0.001 || u_sharpen > 0.001) {
    vec3 diff = c - blur3(v_uv);
    c += diff * (u_clarity * 1.6 + u_sharpen * 1.6);
  }

  // 饱和度 + 自然饱和度
  float l3 = luma(c);
  c = mix(vec3(l3), c, 1.0 + u_saturation);
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float sat = mx - mn;
  c = mix(vec3(luma(c)), c, 1.0 + u_vibrance * (1.0 - sat) * 1.2);

  // 暗角(vignette 为负时压暗)
  if (abs(u_vignette) > 0.001) {
    vec2 d = v_uv - 0.5;
    float r = length(d) * 1.4142136;
    float v = smoothstep(0.45, 1.05, r);
    c *= 1.0 + v * u_vignette * 0.8;
  }

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
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

/**
 * 基于 WebGL 的实时调色管线(非破坏,预览与导出共用同一套 shader)。
 * 不可用时 `supported=false`,调用方退回「仅几何、不调色」。
 */
export class ColorRenderer {
  readonly supported: boolean
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
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
    if (!vs || !fs) {
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
    gl.uniform1f(this.u.u_sharpen ?? null, g(tone.sharpen) )
    gl.uniform1f(this.u.u_denoise ?? null, g(tone.denoise))
    gl.uniform1f(this.u.u_vignette ?? null, g(tone.vignette))
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
