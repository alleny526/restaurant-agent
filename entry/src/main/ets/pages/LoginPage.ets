import { LoginWithHuaweiIDButton, loginComponentManager } from '@kit.AccountKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { AuthUser } from '../model/Models';
import { AuthApi } from '../services/AuthApi';

const COLOR_PRIMARY: string = '#CF0A2C';
const COLOR_PRIMARY_DARK: string = '#A80020';
const COLOR_TEXT: string = '#161616';
const COLOR_MUTED: string = '#7A7A7A';
const COLOR_BG: string = '#FAFAFA';

@Component
export struct LoginPage {
  @Link authToken: string;
  onBack: () => void = () => {};
  onLoginSuccess: (user: AuthUser) => void = () => {};

  @State isLoading: boolean = false;
  @State agreementAccepted: boolean = false;
  @State notice: string = '';

  private huaweiButtonParams: loginComponentManager.LoginWithHuaweiIDButtonParams = {
    style: loginComponentManager.Style.BUTTON_RED,
    borderRadius: 25,
    supportDarkMode: true,
    loginType: loginComponentManager.LoginType.ID,
    textAndIconStyle: true
  };
  private huaweiButtonController: loginComponentManager.LoginWithHuaweiIDButtonController =
    new loginComponentManager.LoginWithHuaweiIDButtonController();

  aboutToAppear(): void {
    this.huaweiButtonController
      .setAgreementStatus(this.agreementAccepted ? loginComponentManager.AgreementStatus.ACCEPTED :
        loginComponentManager.AgreementStatus.NOT_ACCEPTED)
      .onClickEvent((error: BusinessError | undefined, _event: loginComponentManager.ClickEvent) => {
        if (error) {
          if (error.code !== 1001502012) this.notice = this.huaweiErrorMessage(error.code);
          return;
        }
        if (!this.agreementAccepted) {
          this.notice = '请先阅读并同意登录协议';
          return;
        }
        this.notice = '';
        this.huaweiButtonController.setEnabled(false);
      })
      .onClickLoginWithHuaweiIDButton((error: BusinessError | undefined,
        credential: loginComponentManager.HuaweiIDCredential) => {
        if (error) {
          this.huaweiButtonController.setEnabled(true);
          if (error.code !== 1001502012) this.notice = this.huaweiErrorMessage(error.code);
          return;
        }
        this.loginWithHuaweiCode(credential.authorizationCode);
      });
  }

  private huaweiErrorMessage(code: number): string {
    if (code === 1005300001) return '请先阅读并同意登录协议';
    if (code === 1001502001) return '请先在设备设置中登录华为账号';
    if (code === 1001502005) return '网络连接异常，请检查网络后重试';
    if (code === 1001500001) return '应用签名或华为账号 Client ID 配置不正确';
    if (code === 1001500003) return '当前账号或设备暂不支持华为账号登录';
    return '华为账号登录暂不可用，请稍后重试';
  }

  private updateAgreement(value: boolean): void {
    this.agreementAccepted = value;
    this.huaweiButtonController.setAgreementStatus(value ? loginComponentManager.AgreementStatus.ACCEPTED :
      loginComponentManager.AgreementStatus.NOT_ACCEPTED);
    if (value && this.notice === '请先阅读并同意登录协议') this.notice = '';
  }

  private async loginWithHuaweiCode(authorizationCode: string): Promise<void> {
    if (authorizationCode.length === 0) {
      this.notice = '华为账号没有返回有效授权码，请重试';
      this.huaweiButtonController.setEnabled(true);
      return;
    }
    this.isLoading = true;
    this.notice = '';
    try {
      const result = await AuthApi.loginWithHuawei(authorizationCode);
      this.authToken = result.token;
      this.onLoginSuccess(result.user);
    } catch (error) {
      this.notice = (error as Error).message;
    } finally {
      this.isLoading = false;
      this.huaweiButtonController.setEnabled(true);
    }
  }

  @Builder
  private AgreementRow() {
    Row({ space: 8 }) {
      Checkbox({ name: 'loginAgreement', group: 'loginAgreementGroup' })
        .width(22).height(22).select(this.agreementAccepted).selectedColor(COLOR_PRIMARY)
        .onChange((value: boolean) => this.updateAgreement(value))
      Text() {
        Span('已阅读并同意')
        Span('《用户服务协议》').fontColor(COLOR_PRIMARY_DARK)
        Span('《隐私政策》').fontColor(COLOR_PRIMARY_DARK)
        Span('及')
        Span('《华为账号用户认证协议》').fontColor(COLOR_PRIMARY_DARK)
      }
      .fontSize(11).lineHeight(18).fontColor(COLOR_MUTED).layoutWeight(1)
    }
    .alignItems(VerticalAlign.Top).width('100%')
  }

  build() {
    Column() {
      Row() {
        Button('‹').type(ButtonType.Circle).width(40).height(40).fontSize(26)
          .fontColor(COLOR_TEXT).backgroundColor(Color.Transparent).onClick(() => this.onBack())
      }
      .width('100%').padding({ left: 12, right: 12, top: 12 })

      Column() {
        Image($r('app.media.app_icon')).width(76).height(76).borderRadius(20)

        Text('使用华为账号登录')
          .fontSize(28).fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT).margin({ top: 42 })
        Text('登录后可同步个人偏好与用餐记录')
          .fontSize(13).fontColor(COLOR_MUTED).margin({ top: 10 })

        Column({ space: 8 }) {
          Row({ space: 8 }) {
            Text('•').fontSize(18).fontColor(COLOR_PRIMARY)
            Text('账号和密码只在华为系统页面中输入').fontSize(12).fontColor(COLOR_MUTED)
          }
          .width('100%')
          Row({ space: 8 }) {
            Text('•').fontSize(18).fontColor(COLOR_PRIMARY)
            Text('应用仅关联华为账号标识，不读取密码和手机号').fontSize(12).fontColor(COLOR_MUTED)
          }
          .width('100%')
        }
        .margin({ top: 28, bottom: 34 }).padding(14).backgroundColor('#F1F1F1').borderRadius(16).width('100%')

        LoginWithHuaweiIDButton({
          params: this.huaweiButtonParams,
          controller: this.huaweiButtonController
        })
          .height(50).width('100%')

        if (this.isLoading) {
          Row({ space: 8 }) {
            LoadingProgress().width(18).height(18).color(COLOR_PRIMARY)
            Text('正在登录…').fontSize(12).fontColor(COLOR_MUTED)
          }
          .margin({ top: 18 })
        }

        if (this.notice.length > 0) {
          Text(this.notice).fontSize(12).fontColor(COLOR_PRIMARY_DARK).lineHeight(18)
            .textAlign(TextAlign.Center).width('100%').margin({ top: 18 })
        }
      }
      .padding({ left: 28, right: 28, top: 44 }).constraintSize({ maxWidth: 440 })
      .width('100%').alignItems(HorizontalAlign.Center).layoutWeight(1)

      Column() {
        this.AgreementRow()
      }
      .width('100%').padding({ left: 24, right: 24, top: 12, bottom: 18 })
    }
    .width('100%').height('100%').backgroundColor(COLOR_BG)
  }
}
