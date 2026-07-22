import * as THREE from "three";
import { DDSLoader } from "three/addons/loaders/DDSLoader.js";

export interface ClassicDdsTextureSupport {
  readonly nativeS3tc: boolean;
  readonly nativeS3tcSrgb: boolean;
  readonly mode: "native-s3tc" | "cpu-rgba";
}

let support: ClassicDdsTextureSupport = {
  nativeS3tc: true,
  nativeS3tcSrgb: true,
  mode: "native-s3tc",
};

/**
 * Must run once, immediately after WebGLRenderer is created. DXT textures are
 * not portable on Apple mobile GPUs; Three.js otherwise accepts the DDS and
 * only discovers the unsupported format while uploading it, leaving a black
 * surface without rejecting the loader promise.
 */
export function configureClassicDdsTextureSupport(
  renderer: THREE.WebGLRenderer,
): ClassicDdsTextureSupport {
  const nativeS3tc = renderer.extensions.has("WEBGL_compressed_texture_s3tc");
  const nativeS3tcSrgb = renderer.extensions.has("WEBGL_compressed_texture_s3tc_srgb");
  support = {
    nativeS3tc,
    nativeS3tcSrgb,
    // Every classic color texture is tagged sRGB. Three.js requires the sRGB
    // companion extension as well as base S3TC for that upload path.
    mode: nativeS3tc && nativeS3tcSrgb ? "native-s3tc" : "cpu-rgba",
  };
  return support;
}

export function classicDdsTextureSupport(): ClassicDdsTextureSupport {
  return support;
}

/**
 * DDSLoader-compatible loader with a software DXT1/DXT3/DXT5 fallback.
 * Desktop GPUs retain the original compressed fast path. Safari/iOS receives
 * ordinary RGBA mipmaps, supported by every WebGL implementation.
 */
export class ClassicDdsTextureLoader extends THREE.Loader<THREE.Texture> {
  readonly #native: DDSLoader;

  constructor(manager?: THREE.LoadingManager) {
    super(manager);
    this.#native = new DDSLoader(this.manager);
  }

  override load(
    url: string,
    onLoad?: (texture: THREE.Texture) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ): THREE.Texture {
    if (support.mode === "native-s3tc") {
      this.configureLoader(this.#native);
      return this.#native.load(url, onLoad, onProgress, onError);
    }

    const texture = new THREE.DataTexture();
    texture.name = url;
    texture.flipY = false;
    texture.generateMipmaps = false;

    const file = new THREE.FileLoader(this.manager);
    file.setPath(this.path);
    file.setResponseType("arraybuffer");
    file.setRequestHeader(this.requestHeader);
    file.setWithCredentials(this.withCredentials);
    file.load(url, (payload) => {
      try {
        if (!(payload instanceof ArrayBuffer)) {
          throw new TypeError(`DDS ${url} não retornou um ArrayBuffer`);
        }
        const mipmaps = decodeDdsMipmaps(this.#native, payload);
        const top = mipmaps[0];
        if (!top) throw new Error(`DDS ${url} não possui imagem decodificável`);

        texture.image = top;
        const last = mipmaps[mipmaps.length - 1]!;
        const hasCompleteMipChain = mipmaps.length > 1 && last.width === 1 && last.height === 1;
        texture.mipmaps = hasCompleteMipChain ? mipmaps : [];
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = hasCompleteMipChain
          ? THREE.LinearMipmapLinearFilter
          : THREE.LinearFilter;
        texture.needsUpdate = true;
        onLoad?.(texture);
      } catch (error) {
        onError?.(error);
      }
    }, onProgress, onError);
    return texture;
  }

  private configureLoader<TData, TUrl>(loader: THREE.Loader<TData, TUrl>): void {
    loader.setCrossOrigin(this.crossOrigin);
    loader.setWithCredentials(this.withCredentials);
    loader.setPath(this.path);
    loader.setResourcePath(this.resourcePath);
    loader.setRequestHeader(this.requestHeader);
  }
}

interface DecodedMipmap {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
}

function decodeDdsMipmaps(loader: DDSLoader, buffer: ArrayBuffer): DecodedMipmap[] {
  const dds = loader.parse(buffer, true);
  if (dds.isCubemap) throw new Error("DDS cubemap não é suportado pelo fallback móvel");
  if (dds.width < 1 || dds.height < 1 || dds.mipmaps.length === 0) {
    throw new Error("Cabeçalho DDS inválido ou vazio");
  }

  let format: "dxt1" | "dxt3" | "dxt5";
  switch (dds.format) {
    case THREE.RGB_S3TC_DXT1_Format:
    case THREE.RGBA_S3TC_DXT1_Format:
      format = "dxt1";
      break;
    case THREE.RGBA_S3TC_DXT3_Format:
      format = "dxt3";
      break;
    case THREE.RGBA_S3TC_DXT5_Format:
      format = "dxt5";
      break;
    default:
      throw new Error(`Formato DDS ${String(dds.format)} não suportado pelo fallback móvel`);
  }

  return dds.mipmaps.map((mipmap) => {
    const bytes = new Uint8Array(
      mipmap.data.buffer,
      mipmap.data.byteOffset,
      mipmap.data.byteLength,
    );
    return {
      data: decodeDxtLevel(bytes, mipmap.width, mipmap.height, format),
      width: mipmap.width,
      height: mipmap.height,
    };
  });
}

function decodeDxtLevel(
  source: Uint8Array,
  width: number,
  height: number,
  format: "dxt1" | "dxt3" | "dxt5",
): Uint8Array {
  const output = new Uint8Array(width * height * 4);
  const blockBytes = format === "dxt1" ? 8 : 16;
  const blockColumns = Math.ceil(width / 4);
  const blockRows = Math.ceil(height / 4);
  const expectedBytes = blockColumns * blockRows * blockBytes;
  if (source.byteLength < expectedBytes) {
    throw new RangeError(`Bloco ${format.toUpperCase()} truncado: ${source.byteLength}/${expectedBytes}`);
  }

  for (let blockY = 0; blockY < blockRows; blockY++) {
    for (let blockX = 0; blockX < blockColumns; blockX++) {
      const offset = (blockY * blockColumns + blockX) * blockBytes;
      const alpha = format === "dxt3"
        ? decodeDxt3Alpha(source, offset)
        : format === "dxt5"
        ? decodeDxt5Alpha(source, offset)
        : null;
      const colorOffset = offset + (format === "dxt1" ? 0 : 8);
      const colors = decodeColorPalette(
        readUint16(source, colorOffset),
        readUint16(source, colorOffset + 2),
        format === "dxt1",
      );
      const indices = readUint32(source, colorOffset + 4);

      for (let pixel = 0; pixel < 16; pixel++) {
        const localX = pixel & 3;
        const localY = pixel >> 2;
        const x = blockX * 4 + localX;
        const y = blockY * 4 + localY;
        if (x >= width || y >= height) continue;
        const color = colors[(indices >>> (pixel * 2)) & 3]!;
        const destination = (y * width + x) * 4;
        output[destination] = color[0];
        output[destination + 1] = color[1];
        output[destination + 2] = color[2];
        output[destination + 3] = alpha?.[pixel] ?? color[3];
      }
    }
  }
  return output;
}

function decodeColorPalette(
  packed0: number,
  packed1: number,
  allowTransparentEntry: boolean,
): readonly (readonly [number, number, number, number])[] {
  const color0 = rgb565(packed0);
  const color1 = rgb565(packed1);
  if (!allowTransparentEntry || packed0 > packed1) {
    return [
      [...color0, 255],
      [...color1, 255],
      [mix(color0[0], color1[0], 2, 1, 3), mix(color0[1], color1[1], 2, 1, 3), mix(color0[2], color1[2], 2, 1, 3), 255],
      [mix(color0[0], color1[0], 1, 2, 3), mix(color0[1], color1[1], 1, 2, 3), mix(color0[2], color1[2], 1, 2, 3), 255],
    ];
  }
  return [
    [...color0, 255],
    [...color1, 255],
    [mix(color0[0], color1[0], 1, 1, 2), mix(color0[1], color1[1], 1, 1, 2), mix(color0[2], color1[2], 1, 1, 2), 255],
    [0, 0, 0, 0],
  ];
}

function decodeDxt3Alpha(source: Uint8Array, offset: number): Uint8Array {
  const alpha = new Uint8Array(16);
  for (let pixel = 0; pixel < 16; pixel++) {
    const packed = source[offset + (pixel >> 1)] ?? 0;
    alpha[pixel] = ((pixel & 1) === 0 ? packed & 0x0f : packed >>> 4) * 17;
  }
  return alpha;
}

function decodeDxt5Alpha(source: Uint8Array, offset: number): Uint8Array {
  const alpha0 = source[offset] ?? 0;
  const alpha1 = source[offset + 1] ?? 0;
  const palette = new Uint8Array(8);
  palette[0] = alpha0;
  palette[1] = alpha1;
  if (alpha0 > alpha1) {
    for (let index = 1; index <= 6; index++) {
      palette[index + 1] = mix(alpha0, alpha1, 7 - index, index, 7);
    }
  } else {
    for (let index = 1; index <= 4; index++) {
      palette[index + 1] = mix(alpha0, alpha1, 5 - index, index, 5);
    }
    palette[6] = 0;
    palette[7] = 255;
  }

  const alpha = new Uint8Array(16);
  let bits = 0;
  let bitCount = 0;
  let cursor = offset + 2;
  for (let pixel = 0; pixel < 16; pixel++) {
    while (bitCount < 3) {
      bits |= (source[cursor++] ?? 0) << bitCount;
      bitCount += 8;
    }
    alpha[pixel] = palette[bits & 7]!;
    bits >>>= 3;
    bitCount -= 3;
  }
  return alpha;
}

function rgb565(value: number): readonly [number, number, number] {
  return [
    Math.round(((value >>> 11) & 0x1f) * 255 / 31),
    Math.round(((value >>> 5) & 0x3f) * 255 / 63),
    Math.round((value & 0x1f) * 255 / 31),
  ];
}

function mix(a: number, b: number, weightA: number, weightB: number, divisor: number): number {
  return Math.round((a * weightA + b * weightB) / divisor);
}

function readUint16(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8);
}

function readUint32(data: Uint8Array, offset: number): number {
  return (
    (data[offset] ?? 0)
    | ((data[offset + 1] ?? 0) << 8)
    | ((data[offset + 2] ?? 0) << 16)
    | ((data[offset + 3] ?? 0) << 24)
  ) >>> 0;
}
