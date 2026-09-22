import { fileIo } from '@kit.CoreFileKit';
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { image } from '@kit.ImageKit';
import { textRecognition } from '@kit.CoreVisionKit';
import { util } from '@kit.ArkTS';
import { MenuItem } from '../model/Models';

export interface PickedMenuImage {
  fileName: string;
  mimeType: string;
  base64: string;
  recognizedMenu: MenuItem[];
}

export class MenuImagePicker {
  private static parseMenuLines(lines: string[]): MenuItem[] {
    const items: MenuItem[] = [];
    const names: Set<string> = new Set<string>();
    const pricePattern: RegExp = /^(.*?)[\s·.。…_\-]*(?:¥|￥)?\s*(\d{1,4}(?:\.\d{1,2})?)\s*(?:元|\/(?:份|例|位))?\s*$/;
    for (const rawLine of lines) {
      // Dianping-style rows often contain a popularity marker such as
      // “赞12” between the dish name and the right-aligned price.
      const line: string = rawLine.replace(/(?:赞|👍)\s*\+?\s*\d+/gu, ' ')
        .replace(/\s+/g, ' ').trim();
      const match: RegExpMatchArray | null = line.match(pricePattern);
      if (match === null) {
        continue;
      }
      const name: string = match[1].replace(/[\s·.。…_\-]+$/g, '').trim();
      const price: number = Number(match[2]);
      if (name.length < 2 || name.length > 100 || !Number.isFinite(price) || price <= 0 || price > 2000 ||
        names.has(name) || /^(菜单|菜品|价格|电话|地址|合计|总计)$/.test(name)) {
        continue;
      }
      names.add(name);
      const hasExplicitPrice: boolean = /[¥￥元]/.test(line);
      items.push({
        id: `device-ocr-${items.length + 1}`,
        name,
        category: '待确认',
        price,
        ingredients: [],
        confidence: hasExplicitPrice ? 0.92 : 0.78
      } as MenuItem);
      if (items.length >= 100) {
        break;
      }
    }
    return items;
  }

  private static async recognizeMenu(fileDescriptor: number): Promise<MenuItem[]> {
    let source: image.ImageSource | undefined = undefined;
    let pixelMap: image.PixelMap | undefined = undefined;
    let initialized: boolean = false;
    try {
      initialized = await textRecognition.init();
      if (!initialized) {
        return [];
      }
      source = image.createImageSource(fileDescriptor);
      pixelMap = await source.createPixelMap();
      const result = await textRecognition.recognizeText({ pixelMap });
      const lines: string[] = [];
      for (const block of result.blocks) {
        for (const line of block.lines) {
          if (line.value.trim().length > 0) {
            lines.push(line.value);
          }
        }
      }
      return MenuImagePicker.parseMenuLines(lines);
    } catch (_error) {
      return [];
    } finally {
      if (pixelMap !== undefined) {
        await pixelMap.release();
      }
      if (source !== undefined) {
        await source.release();
      }
      if (initialized) {
        await textRecognition.release();
      }
    }
  }

  private static async normalizeForModel(fileDescriptor: number): Promise<ArrayBuffer> {
    let source: image.ImageSource | undefined = undefined;
    let pixelMap: image.PixelMap | undefined = undefined;
    try {
      source = image.createImageSource(fileDescriptor);
      pixelMap = await source.createPixelMap();
      const imageInfo: image.ImageInfo = await pixelMap.getImageInfo();
      const longestEdge: number = Math.max(imageInfo.size.width, imageInfo.size.height);
      if (longestEdge > 1600) {
        const scale: number = 1600 / longestEdge;
        await pixelMap.scale(scale, scale);
      }
      const packer: image.ImagePacker = image.createImagePacker();
      return await packer.packToData(pixelMap, {
        format: 'image/jpeg',
        quality: 82,
        bufferSize: 4 * 1024 * 1024
      });
    } catch (error) {
      const message: string = (error as Error).message;
      throw new Error(message.length > 0 ? message : '菜单图片格式转换失败');
    } finally {
      if (pixelMap !== undefined) {
        await pixelMap.release();
      }
      if (source !== undefined) {
        await source.release();
      }
    }
  }

  static async pick(): Promise<PickedMenuImage | null> {
    try {
      const picker = new photoAccessHelper.PhotoViewPicker();
      const options = new photoAccessHelper.PhotoSelectOptions();
      options.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE;
      options.maxSelectNumber = 1;
      const result = await picker.select(options);
      if (result.photoUris.length === 0) {
        return null;
      }
      const uri = result.photoUris[0];
      const stat = fileIo.statSync(uri);
      if (stat.size > 20 * 1024 * 1024) {
        throw new Error('菜单图片不能超过 20 MB，请裁剪后重试');
      }
      const ocrFile = fileIo.openSync(uri, fileIo.OpenMode.READ_ONLY);
      const modelFile = fileIo.openSync(uri, fileIo.OpenMode.READ_ONLY);
      try {
        const helper = new util.Base64Helper();
        const ocrTask: Promise<MenuItem[]> = MenuImagePicker.recognizeMenu(ocrFile.fd);
        const normalizeTask: Promise<ArrayBuffer> = MenuImagePicker.normalizeForModel(modelFile.fd);
        const recognizedMenu: MenuItem[] = await ocrTask;
        const uploadBuffer: ArrayBuffer = await normalizeTask;
        if (uploadBuffer.byteLength > 4 * 1024 * 1024) {
          throw new Error('菜单图片转换后仍超过 4 MB，请裁剪后重试');
        }
        return {
          fileName: `menu-${Date.now()}.jpg`,
          mimeType: 'image/jpeg',
          base64: helper.encodeToStringSync(new Uint8Array(uploadBuffer)),
          recognizedMenu
        };
      } finally {
        fileIo.closeSync(ocrFile.fd);
        fileIo.closeSync(modelFile.fd);
      }
    } catch (error) {
      const message: string = (error as Error).message;
      throw new Error(message.length > 0 ? message : '读取菜单图片失败');
    }
  }
}
