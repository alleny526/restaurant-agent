import { LoginWithHuaweiIDButton, loginComponentManager } from '@kit.AccountKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { AuthResponse, AuthUser } from '../model/Models';
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
    if (code === 1001502003) return '华为账号 Client ID 或签名 Profile 无效，请重新同步 AGC 签名配置';
    if (code === 1001502005) return '网络连接异常，请检查网络后重试';
    if (code === 1001500001) return '应用签名或华为账号 Client ID 配置不正确';
    if (code === 1001500003) return '当前账号或设备暂不支持华为账号登录';
    return `华为账号登录暂不可用（错误码 ${code}）`;
  }

  private updateAgreement(value: boolean): void {
    this.agreementAccepted = value;
    this.huaweiButtonController.setAgreementStatus(value ? loginComponentManager.AgreementStatus.ACCEPTED :
      loginComponentManager.AgreementStatus.NOT_ACCEPTED);
    if (value && this.notice.includes('请先阅读并同意')) this.notice = '';
  }

  private switchAccountMode(mode: string): void {
    this.accountMode = mode;
    this.notice = '';
    this.password = '';
    this.confirmPassword = '';
  }

  private completeLogin(result: AuthResponse): void {
    this.authToken = result.token;
    this.onLoginSuccess(result.user);
  }

  private async submitAccountForm(): Promise<void> {
    const account: string = this.account.trim();
    const nickname: string = this.nickname.trim();
    if (this.accountMode === 'register' && nickname.length === 0) {
      this.notice = '请输入昵称';
      return;
    }
    if (account.length < 3 || account.includes(' ')) {
      this.notice = '请输入至少 3 位且不含空格的手机号或用户名';
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
    this.isLoading = true;
    this.notice = '';
    try {
      const result: AuthResponse = this.accountMode === 'register'
        ? await AuthApi.register(nickname, account, this.password)
        : await AuthApi.login(account, this.password);
      this.completeLogin(result);
    } catch (error) {
      this.notice = (error as Error).message;
    } finally {
      this.isLoading = false;
    }
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
      this.completeLogin(await AuthApi.loginWithHuawei(authorizationCode));
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
      .type(ButtonType.Normal).layoutWeight(1).height(40).fontSize(14)
      .fontWeight(this.accountMode === mode ? FontWeight.Bold : FontWeight.Medium)
      .fontColor(this.accountMode === mode ? COLOR_PRIMARY_DARK : COLOR_MUTED)
      .backgroundColor(this.accountMode === mode ? Color.White : Color.Transparent)
      .borderRadius(13).onClick(() => this.switchAccountMode(mode))
  }

  @Builder
  private FieldLabel(label: string) {
    Text(label).fontSize(12).fontWeight(FontWeight.Medium).fontColor(COLOR_TEXT).width('100%')
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
        Column({ space: 18 }) {
          Column({ space: 8 }) {
            Image($r('app.media.app_icon')).width(64).height(64).borderRadius(18)
            Text(this.accountMode === 'login' ? '欢迎回来' : '创建你的账号')
              .fontSize(26).fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT)
            Text('登录后可同步个人偏好、用餐记录与评论身份')
              .fontSize(12).fontColor(COLOR_MUTED).textAlign(TextAlign.Center)
          }
          .width('100%')

          Column({ space: 15 }) {
            Row({ space: 4 }) {
              this.ModeButton('登录', 'login')
              this.ModeButton('注册', 'register')
            }
            .padding(4).height(48).backgroundColor('#F4ECE7').borderRadius(16).width('100%')

            if (this.accountMode === 'register') {
              Column({ space: 6 }) {
                this.FieldLabel('昵称')
                TextInput({ text: this.nickname, placeholder: '用于个人资料与评论展示' })
                  .height(46).backgroundColor('#FFFDFC').borderRadius(13)
                  .border({ width: 1, color: COLOR_LINE })
                  .onChange((value: string) => this.nickname = value)
              }.width('100%')
            }

            Column({ space: 6 }) {
              this.FieldLabel('手机号或用户名')
              TextInput({ text: this.account, placeholder: '请输入至少 3 位账号' })
                .height(46).backgroundColor('#FFFDFC').borderRadius(13)
                .border({ width: 1, color: COLOR_LINE })
                .onChange((value: string) => this.account = value)
            }.width('100%')

            Column({ space: 6 }) {
              this.FieldLabel('密码')
              TextInput({ text: this.password, placeholder: '至少 6 位' })
                .type(InputType.Password).height(46).backgroundColor('#FFFDFC').borderRadius(13)
                .border({ width: 1, color: COLOR_LINE })
                .onChange((value: string) => this.password = value)
            }.width('100%')

            if (this.accountMode === 'register') {
              Column({ space: 6 }) {
                this.FieldLabel('确认密码')
                TextInput({ text: this.confirmPassword, placeholder: '请再次输入密码' })
                  .type(InputType.Password).height(46).backgroundColor('#FFFDFC').borderRadius(13)
                  .border({ width: 1, color: COLOR_LINE })
                  .onChange((value: string) => this.confirmPassword = value)
              }.width('100%')
            }

            Button(this.isLoading ? '处理中…' : (this.accountMode === 'login' ? '登录' : '注册并登录'))
              .type(ButtonType.Normal).height(48).width('100%').fontSize(15).fontWeight(FontWeight.Bold)
              .fontColor(Color.White).backgroundColor(COLOR_PRIMARY).borderRadius(15)
              .enabled(!this.isLoading).onClick(() => this.submitAccountForm())

            Row({ space: 12 }) {
              Divider().color(COLOR_LINE).layoutWeight(1)
              Text('或').fontSize(11).fontColor('#A99A92')
              Divider().color(COLOR_LINE).layoutWeight(1)
            }.width('100%')

            LoginWithHuaweiIDButton({
              params: this.huaweiButtonParams,
              controller: this.huaweiButtonController
            }).height(48).width('100%')

            if (this.notice.length > 0) {
              Text(this.notice).fontSize(12).fontColor(COLOR_PRIMARY_DARK).lineHeight(18)
                .textAlign(TextAlign.Center).padding(10).backgroundColor('#FFF0E8').borderRadius(10).width('100%')
            }

            this.AgreementRow()
          }
          .padding(18).backgroundColor(Color.White).borderRadius(20).width('100%')
        }
        .padding({ left: 20, right: 20, top: 12, bottom: 24 }).constraintSize({ maxWidth: 440 }).width('100%')
      }
      .scrollBar(BarState.Off).layoutWeight(1).width('100%')
    }
    .width('100%').height('100%').backgroundColor(COLOR_BG)
  }
}
