import { LoginWithHuaweiIDButton, loginComponentManager } from '@kit.AccountKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { AuthUser } from '../model/Models';
import { AuthApi } from '../services/AuthApi';

const COLOR_PRIMARY: string = '#E95E35';
const COLOR_PRIMARY_DARK: string = '#BF3E1E';
const COLOR_HUAWEI: string = '#CF0A2C';
const COLOR_TEXT: string = '#2A211D';
const COLOR_MUTED: string = '#81736C';
const COLOR_LINE: string = '#EFE5DF';
const COLOR_BG: string = '#FFF9F5';

@Component
export struct LoginPage {
  @Link authToken: string;
  onBack: () => void = () => {};
  onLoginSuccess: (user: AuthUser) => void = () => {};

  @State isLoading: boolean = false;
  @State agreementAccepted: boolean = false;
  @State notice: string = '';
  @State accountMode: string = 'login';
  @State nickname: string = '';
  @State account: string = '';
  @State password: string = '';
  @State confirmPassword: string = '';

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

  private switchAccountMode(mode: string): void {
    this.accountMode = mode;
    this.notice = '';
    this.password = '';
    this.confirmPassword = '';
  }

  private submitAccountForm(): void {
    if (this.accountMode === 'register' && this.nickname.trim().length === 0) {
      this.notice = '请输入昵称';
      return;
    }
    if (this.account.trim().length === 0) {
      this.notice = '请输入手机号或用户名';
      return;
    }
    if (this.password.length < 6) {
      this.notice = '密码长度不能少于 6 位';
      return;
    }
    if (this.accountMode === 'register' && this.password !== this.confirmPassword) {
      this.notice = '两次输入的密码不一致';
      return;
    }
    if (!this.agreementAccepted) {
      this.notice = '请先阅读并同意用户协议与隐私政策';
      return;
    }
    this.notice = this.accountMode === 'login' ? '普通账号登录服务暂未接入' : '普通账号注册服务暂未接入';
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
        Span('，使用华为账号登录时同时同意')
        Span('《华为账号用户认证协议》').fontColor(COLOR_HUAWEI)
      }
      .fontSize(11).lineHeight(18).fontColor(COLOR_MUTED).layoutWeight(1)
    }
    .alignItems(VerticalAlign.Top).width('100%')
  }

  @Builder
  private ModeButton(label: string, mode: string) {
    Button(label)
      .type(ButtonType.Normal)
      .layoutWeight(1)
      .height(42)
      .fontSize(14)
      .fontWeight(this.accountMode === mode ? FontWeight.Bold : FontWeight.Medium)
      .fontColor(this.accountMode === mode ? COLOR_TEXT : COLOR_MUTED)
      .backgroundColor(this.accountMode === mode ? Color.White : Color.Transparent)
      .borderRadius(13)
      .shadow(this.accountMode === mode ? {
        radius: 8,
        color: '#12000000',
        offsetX: 0,
        offsetY: 2
      } : { radius: 0, color: Color.Transparent, offsetX: 0, offsetY: 0 })
      .onClick(() => this.switchAccountMode(mode))
  }

  @Builder
  private FieldLabel(label: string) {
    Text(label)
      .fontSize(12)
      .fontWeight(FontWeight.Medium)
      .fontColor(COLOR_TEXT)
      .width('100%')
  }

  build() {
    Column() {
      Row() {
        Button('‹').type(ButtonType.Circle).width(40).height(40).fontSize(26)
          .fontColor(COLOR_TEXT).backgroundColor(Color.Transparent).onClick(() => this.onBack())
        Blank()
        Text(this.accountMode === 'login' ? '登录' : '注册')
          .fontSize(14).fontWeight(FontWeight.Medium).fontColor(COLOR_MUTED)
        Blank().width(40)
      }
      .width('100%').padding({ left: 12, right: 12, top: 10, bottom: 4 })

      Scroll() {
        Column({ space: 20 }) {
          Column({ space: 10 }) {
            Image($r('app.media.app_icon')).width(68).height(68).borderRadius(19)
            Text(this.accountMode === 'login' ? '欢迎回来' : '创建你的账号')
              .fontSize(27).fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT)
            Text(this.accountMode === 'login' ? '登录后继续发现合你口味的餐厅' : '注册后即可保存偏好并同步用餐记录')
              .fontSize(13).fontColor(COLOR_MUTED).textAlign(TextAlign.Center)
          }
          .width('100%')

          Column({ space: 17 }) {
            Row({ space: 4 }) {
              this.ModeButton('登录', 'login')
              this.ModeButton('注册', 'register')
            }
            .padding(4).height(50).backgroundColor('#F4ECE7').borderRadius(16).width('100%')

            if (this.accountMode === 'register') {
              Column({ space: 7 }) {
                this.FieldLabel('昵称')
                TextInput({ text: this.nickname, placeholder: '请输入昵称' })
                  .height(48).fontSize(14).fontColor(COLOR_TEXT).placeholderColor('#B4A7A0')
                  .backgroundColor('#FFFDFC').borderRadius(14)
                  .border({ width: 1, color: COLOR_LINE })
                  .onChange((value: string) => this.nickname = value)
              }
              .alignItems(HorizontalAlign.Start).width('100%')
            }

            Column({ space: 7 }) {
              this.FieldLabel('手机号或用户名')
              TextInput({ text: this.account, placeholder: '请输入手机号或用户名' })
                .height(48).fontSize(14).fontColor(COLOR_TEXT).placeholderColor('#B4A7A0')
                .backgroundColor('#FFFDFC').borderRadius(14)
                .border({ width: 1, color: COLOR_LINE })
                .onChange((value: string) => this.account = value)
            }
            .alignItems(HorizontalAlign.Start).width('100%')

            Column({ space: 7 }) {
              this.FieldLabel('密码')
              TextInput({ text: this.password, placeholder: this.accountMode === 'login' ? '请输入密码' : '请设置至少 6 位密码' })
                .type(InputType.Password).height(48).fontSize(14).fontColor(COLOR_TEXT)
                .placeholderColor('#B4A7A0').backgroundColor('#FFFDFC').borderRadius(14)
                .border({ width: 1, color: COLOR_LINE })
                .onChange((value: string) => this.password = value)
            }
            .alignItems(HorizontalAlign.Start).width('100%')

            if (this.accountMode === 'register') {
              Column({ space: 7 }) {
                this.FieldLabel('确认密码')
                TextInput({ text: this.confirmPassword, placeholder: '请再次输入密码' })
                  .type(InputType.Password).height(48).fontSize(14).fontColor(COLOR_TEXT)
                  .placeholderColor('#B4A7A0').backgroundColor('#FFFDFC').borderRadius(14)
                  .border({ width: 1, color: COLOR_LINE })
                  .onChange((value: string) => this.confirmPassword = value)
              }
              .alignItems(HorizontalAlign.Start).width('100%')
            } else {
              Text('忘记密码？')
                .fontSize(12).fontColor(COLOR_PRIMARY_DARK).width('100%').textAlign(TextAlign.End)
            }

            Button(this.accountMode === 'login' ? '登录' : '注册')
              .type(ButtonType.Normal).height(48).width('100%').fontSize(15).fontWeight(FontWeight.Bold)
              .fontColor(Color.White).backgroundColor(COLOR_PRIMARY).borderRadius(15)
              .onClick(() => this.submitAccountForm())

            Row({ space: 12 }) {
              Divider().color(COLOR_LINE).layoutWeight(1)
              Text('其他登录方式').fontSize(11).fontColor('#A99A92')
              Divider().color(COLOR_LINE).layoutWeight(1)
            }
            .width('100%')

            LoginWithHuaweiIDButton({
              params: this.huaweiButtonParams,
              controller: this.huaweiButtonController
            })
              .height(48).width('100%')

            Text('使用华为账号安全登录')
              .fontSize(11).fontColor(COLOR_MUTED).width('100%').textAlign(TextAlign.Center)

            if (this.isLoading) {
              Row({ space: 8 }) {
                LoadingProgress().width(18).height(18).color(COLOR_HUAWEI)
                Text('正在登录…').fontSize(12).fontColor(COLOR_MUTED)
              }
            }

            if (this.notice.length > 0) {
              Text(this.notice)
                .fontSize(12).fontColor(COLOR_PRIMARY_DARK).lineHeight(18).textAlign(TextAlign.Center)
                .padding(10).backgroundColor('#FFF0E8').borderRadius(10).width('100%')
            }

            this.AgreementRow()
          }
          .padding(18).backgroundColor(Color.White).borderRadius(22).width('100%')
          .shadow({ radius: 18, color: '#0D5B3828', offsetX: 0, offsetY: 6 })
        }
        .padding({ left: 20, right: 20, top: 14, bottom: 24 })
        .constraintSize({ maxWidth: 440 }).width('100%')
      }
      .scrollBar(BarState.Off).layoutWeight(1).width('100%')
    }
    .width('100%').height('100%').backgroundColor(COLOR_BG)
  }
}
