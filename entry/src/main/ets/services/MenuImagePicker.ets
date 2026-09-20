import { fileIo } from '@kit.CoreFileKit';
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { util } from '@kit.ArkTS';

export interface PickedMenuImage {
  fileName: string;
  mimeType: string;
  base64: string;
}

export class MenuImagePicker {
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
      if (stat.size > 4 * 1024 * 1024) {
        throw new Error('菜单图片不能超过 4 MB，请裁剪或压缩后重试');
      }
      const file = fileIo.openSync(uri, fileIo.OpenMode.READ_ONLY);
      try {
        const buffer = new ArrayBuffer(stat.size);
        fileIo.readSync(file.fd, buffer);
        const helper = new util.Base64Helper();
        return {
          fileName: `menu-${Date.now()}.jpg`,
          mimeType: 'image/jpeg',
          base64: helper.encodeToStringSync(new Uint8Array(buffer))
        };
      } finally {
        fileIo.closeSync(file.fd);
      }
    } catch (error) {
      const message: string = (error as Error).message;
      throw new Error(message.length > 0 ? message : '读取菜单图片失败');
    }
  }
}
