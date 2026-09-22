import { fileIo } from '@kit.CoreFileKit';
import { image } from '@kit.ImageKit';
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { util } from '@kit.ArkTS';

export class AvatarImagePicker {
  static async pick(): Promise<string | null> {
    try {
      const picker = new photoAccessHelper.PhotoViewPicker();
      const options = new photoAccessHelper.PhotoSelectOptions();
      options.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE;
      options.maxSelectNumber = 1;
      const result = await picker.select(options);
      if (result.photoUris.length === 0) return null;

      const uri: string = result.photoUris[0];
      const stat = fileIo.statSync(uri);
      if (stat.size > 15 * 1024 * 1024) {
        throw new Error('头像图片不能超过 15 MB');
      }

      const selectedFile = fileIo.openSync(uri, fileIo.OpenMode.READ_ONLY);
      let source: image.ImageSource | undefined = undefined;
      let pixelMap: image.PixelMap | undefined = undefined;
      try {
        source = image.createImageSource(selectedFile.fd);
        pixelMap = await source.createPixelMap();
        const info: image.ImageInfo = await pixelMap.getImageInfo();
        const longestEdge: number = Math.max(info.size.width, info.size.height);
        if (longestEdge > 640) {
          const scale: number = 640 / longestEdge;
          await pixelMap.scale(scale, scale);
        }
        const packer: image.ImagePacker = image.createImagePacker();
        const buffer: ArrayBuffer = await packer.packToData(pixelMap, {
          format: 'image/jpeg', quality: 80, bufferSize: 2 * 1024 * 1024
        });
        if (buffer.byteLength > 1500 * 1024) {
          throw new Error('头像压缩后仍然过大，请选择其他图片');
        }
        const helper = new util.Base64Helper();
        return `data:image/jpeg;base64,${helper.encodeToStringSync(new Uint8Array(buffer))}`;
      } finally {
        if (pixelMap !== undefined) await pixelMap.release();
        if (source !== undefined) await source.release();
        fileIo.closeSync(selectedFile.fd);
      }
    } catch (error) {
      const message: string = (error as Error).message;
      throw new Error(message.length > 0 ? message : '读取头像失败');
    }
  }
}
