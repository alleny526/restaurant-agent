import { AuthUser } from '../model/Models';
import { AuthApi } from '../services/AuthApi';

const COLOR_PRIMARY: string = '#E95E35';
const COLOR_PRIMARY_DARK: string = '#BF3E1E';
const COLOR_TEXT: string = '#2A201C';
const COLOR_MUTED: string = '#786B64';
const COLOR_BG: string = '#FFF8F3';

@Component
export struct LoginPage {
  @Link authToken: string;
  onBack: () => void = () => {};
  onLoginSuccess: (user: AuthUser) => void = () => {};

  @State phoneInput: string = '';
  @State codeInput: string = '';
  @State otpRequestId: string = '';
  @State isLoading: boolean = false;
  @State notice: string = '';

  private async requestOtp(): Promise<void> {
    if (!/^1\d{10}$/.test(this.phoneInput)) {
      this.notice = '请输入有效的 11 位手机号';
      return;
    }
    this.isLoading = true;
    this.notice = '';
    try {
      const result = await AuthApi.requestOtp(this.phoneInput);
      this.otpRequestId = result.requestId;
      this.notice = result.debugCode.length > 0 ? `演示验证码：${result.debugCode}` : '验证码已发送，请注意查收';
    } catch (error) {
      this.notice = (error as Error).message;
    } finally {
      this.isLoading = false;
    }
  }

  private async login(): Promise<void> {
    if (this.otpRequestId.length === 0) {
      this.notice = '请先获取验证码';
      return;
    }
    if (!/^\d{6}$/.test(this.codeInput)) {
      this.notice = '请输入 6 位验证码';
      return;
    }
    this.isLoading = true;
    this.notice = '';
    try {
      const result = await AuthApi.verifyOtp(this.otpRequestId, this.phoneInput, this.codeInput);
      this.authToken = result.token;
      this.onLoginSuccess(result.user);
    } catch (error) {
      this.notice = (error as Error).message;
    } finally {
      this.isLoading = false;
    }
  }

  build() {
    Column() {
      Row({ space: 12 }) {
        Button('‹').type(ButtonType.Circle).width(38).height(38).fontSize(24)
          .fontColor(COLOR_TEXT).backgroundColor('#FFF0E8').onClick(() => this.onBack())
        Text('登录').fontSize(20).fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT)
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 14, bottom: 8 })

      Scroll() {
        Column({ space: 22 }) {
          Column({ space: 9 }) {
            Text('欢迎来到小艺餐厅').fontSize(27).fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT).width('100%')
            Text('登录后可同步个人资料、饮食偏好和后续用餐记录。')
              .fontSize(14).lineHeight(21).fontColor(COLOR_MUTED).width('100%')
          }
          .alignItems(HorizontalAlign.Start).width('100%')

          Column({ space: 14 }) {
            Column({ space: 7 }) {
              Text('手机号').fontSize(13).fontWeight(FontWeight.Medium).fontColor(COLOR_TEXT).width('100%')
              TextInput({ text: this.phoneInput, placeholder: '请输入 11 位手机号' })
                .type(InputType.PhoneNumber).height(50).backgroundColor('#FFFDFC').borderRadius(14)
                .onChange((value: string) => this.phoneInput = value)
            }
            .width('100%')

            Column({ space: 7 }) {
              Text('验证码').fontSize(13).fontWeight(FontWeight.Medium).fontColor(COLOR_TEXT).width('100%')
              Row({ space: 9 }) {
                TextInput({ text: this.codeInput, placeholder: '请输入验证码' })
                  .type(InputType.Number).height(50).layoutWeight(1).backgroundColor('#FFFDFC').borderRadius(14)
                  .onChange((value: string) => this.codeInput = value)
                Button(this.isLoading ? '请稍候' : '获取验证码')
                  .height(50).fontSize(12).enabled(!this.isLoading).fontColor(COLOR_PRIMARY_DARK)
                  .backgroundColor('#FFF0E8').borderRadius(14).onClick(() => this.requestOtp())
              }
              .width('100%')
            }
            .width('100%')

            if (this.notice.length > 0) {
              Text(this.notice).fontSize(12).fontColor('#9A3D25').padding(10)
                .backgroundColor('#FFF0E8').borderRadius(10).width('100%')
            }

            Button(this.isLoading ? '登录中…' : '登录 / 注册')
              .height(50).width('100%').enabled(!this.isLoading).fontSize(16).fontWeight(FontWeight.Medium)
              .fontColor(Color.White).backgroundColor(COLOR_PRIMARY).borderRadius(15).onClick(() => this.login())
          }
          .padding(18).backgroundColor(Color.White).borderRadius(22).width('100%')

          Text('登录即表示你同意服务条款和隐私说明。当前为开发演示环境，验证码会直接显示在页面中。')
            .fontSize(11).lineHeight(18).fontColor('#99867D').textAlign(TextAlign.Center).width('100%')
        }
        .padding({ left: 18, right: 18, top: 26, bottom: 26 })
      }
      .scrollBar(BarState.Off).layoutWeight(1).width('100%')
    }
    .width('100%').height('100%').backgroundColor(COLOR_BG)
  }
}
