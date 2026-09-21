import { LengthMetrics } from '@kit.ArkUI';
import { AuthUser, SessionState, UserProfile } from '../model/Models';
import { AuthApi } from '../services/AuthApi';
import { LoginPage } from './LoginPage';
import { PreferenceEditPage } from './PreferenceEditPage';

const COLOR_PRIMARY: string = '#E95E35';
const COLOR_PRIMARY_DARK: string = '#BF3E1E';
const COLOR_TEXT: string = '#2A201C';
const COLOR_MUTED: string = '#786B64';
const COLOR_LINE: string = '#EFE3DB';
const COLOR_BG: string = '#FFF8F3';

@Component
export struct ProfilePage {
  @Link profile: UserProfile;
  @Link session: SessionState;
  @Link authToken: string;
  onLoginPageChange: (show: boolean) => void = () => {};

  @State showLogin: boolean = false;
  @State showPreferenceEditor: boolean = false;
  @State editNickname: string = '';
  @State editHometown: string = '';
  @State isLoading: boolean = false;
  @State notice: string = '';

  aboutToAppear(): void {
    if (this.authToken.length > 0) {
      this.restoreProfile();
    }
  }

  private isLoggedIn(): boolean {
    return this.authToken.length > 0 && this.profile.userId !== 'guest';
  }

  private async restoreProfile(): Promise<void> {
    try {
      const user = await AuthApi.getProfile(this.authToken);
      this.applyUser(user);
    } catch (error) {
      const message: string = (error as Error).message;
      if (message.includes('登录已失效') || message.includes('用户不存在')) {
        this.authToken = '';
      }
      this.notice = `暂时无法恢复登录资料：${message}`;
    }
  }

  private applyUser(user: AuthUser): void {
    this.profile = {
      userId: user.id,
      nickname: user.nickname,
      phone: user.phone,
      hometown: user.hometown,
      dietaryRestrictions: user.dietaryRestrictions,
      tastePreferences: user.tastePreferences,
      cuisinePreferences: user.cuisinePreferences,
      personalizationEnabled: user.personalizationEnabled
    } as UserProfile;
    this.session = {
      sessionId: this.session.sessionId,
      stage: this.session.stage,
      selectedRestaurantId: this.session.selectedRestaurantId,
      userId: user.id
    } as SessionState;
    this.editNickname = user.nickname;
    this.editHometown = user.hometown;
  }

  private loginSucceeded(user: AuthUser): void {
    this.applyUser(user);
    this.showLogin = false;
    this.onLoginPageChange(false);
    this.notice = '登录成功，个人资料已同步';
  }

  private openLogin(): void {
    this.showLogin = true;
    this.onLoginPageChange(true);
  }

  private closeLogin(): void {
    this.showLogin = false;
    this.onLoginPageChange(false);
  }

  private openPreferenceEditor(): void {
    this.showPreferenceEditor = true;
    this.onLoginPageChange(true);
  }

  private closePreferenceEditor(): void {
    this.showPreferenceEditor = false;
    this.onLoginPageChange(false);
  }

  private preferencesSaved(): void {
    this.showPreferenceEditor = false;
    this.onLoginPageChange(false);
    this.notice = this.isLoggedIn() ? '饮食偏好已同步到账号' : '饮食偏好已更新';
  }

  private logout(): void {
    this.authToken = '';
    this.profile = {
      userId: 'guest', nickname: '游客', phone: '', hometown: '', dietaryRestrictions: ['花生'],
      tastePreferences: ['清淡'], cuisinePreferences: ['江浙菜'], personalizationEnabled: true
    } as UserProfile;
    this.session = {
      sessionId: this.session.sessionId,
      stage: this.session.stage,
      selectedRestaurantId: this.session.selectedRestaurantId,
      userId: 'guest'
    } as SessionState;
    this.editNickname = '';
    this.editHometown = '';
    this.notice = '已退出登录，当前为游客模式';
  }

  private async saveProfile(): Promise<void> {
    if (!this.isLoggedIn()) {
      this.openLogin();
      return;
    }
    const nickname: string = this.editNickname.trim().length > 0 ? this.editNickname.trim() : this.profile.nickname;
    const updated: UserProfile = {
      userId: this.profile.userId,
      nickname,
      phone: this.profile.phone,
      hometown: this.editHometown.trim(),
      dietaryRestrictions: this.profile.dietaryRestrictions,
      tastePreferences: this.profile.tastePreferences,
      cuisinePreferences: this.profile.cuisinePreferences,
      personalizationEnabled: this.profile.personalizationEnabled
    } as UserProfile;
    this.isLoading = true;
    this.notice = '';
    try {
      const user = await AuthApi.updateProfile(this.authToken, updated);
      this.applyUser(user);
      this.notice = '个人资料已保存';
    } catch (error) {
      this.notice = (error as Error).message;
    } finally {
      this.isLoading = false;
    }
  }

  @Builder
  private PreferenceChip(label: string) {
    Text(label)
      .fontSize(12).fontColor(COLOR_PRIMARY_DARK)
      .padding({ left: 13, right: 13, top: 7, bottom: 7 })
      .backgroundColor('#FFF0E8').borderRadius(18)
  }

  @Builder
  private PreferenceSummary(title: string, selected: string[]) {
    Column({ space: 9 }) {
      Text(title).fontSize(14).fontWeight(FontWeight.Medium).fontColor(COLOR_TEXT).width('100%')
      if (selected.length > 0) {
        Flex({ wrap: FlexWrap.Wrap, space: { main: LengthMetrics.vp(8), cross: LengthMetrics.vp(8) } }) {
          ForEach(selected, (value: string) => this.PreferenceChip(value))
        }
        .width('100%')
      } else {
        Text('未设置').fontSize(12).fontColor('#A99A92')
      }
    }
    .alignItems(HorizontalAlign.Start).width('100%')
  }

  @Builder
  private AccountCard() {
    Column({ space: 14 }) {
      Row({ space: 14 }) {
        Column() {
          Text(this.isLoggedIn() && this.profile.nickname.length > 0 ? this.profile.nickname.substring(0, 1) : '游')
            .fontSize(25).fontWeight(FontWeight.Bold).fontColor(Color.White)
        }
        .width(58).height(58).justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center)
        .backgroundColor(this.isLoggedIn() ? COLOR_PRIMARY : '#C7B8AF').borderRadius(29)

        Column({ space: 5 }) {
          Text(this.isLoggedIn() ? (this.profile.nickname || '小艺用户') : '游客用户')
            .fontSize(20).fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT)
          Text(this.isLoggedIn() ? (this.profile.phone.length > 0 ? this.profile.phone : '华为账号已登录') :
            '登录后同步个人资料与饮食偏好')
            .fontSize(12).fontColor(COLOR_MUTED)
        }
        .alignItems(HorizontalAlign.Start).layoutWeight(1)

        if (!this.isLoggedIn()) {
          Text('›').fontSize(28).fontColor('#B9A9A0')
        } else {
          Text('已同步').fontSize(11).fontColor('#2E8B57')
        }
      }
      .width('100%')

      if (!this.isLoggedIn()) {
        Button('登录 / 注册')
          .type(ButtonType.Normal).height(42).width('100%').fontSize(14).fontColor(Color.White)
          .backgroundColor(COLOR_PRIMARY).borderRadius(14).onClick(() => this.openLogin())
      }
    }
    .padding(17).backgroundColor(Color.White).borderRadius(22).width('100%')
    .onClick(() => {
      if (!this.isLoggedIn()) this.openLogin();
    })
  }

  @Builder
  private ProfileContent() {
    Column() {
      Column({ space: 4 }) {
        Text('我的').fontSize(26).fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT).width('100%')
        Text('管理账户、偏好与隐私设置').fontSize(13).fontColor(COLOR_MUTED).width('100%')
      }
      .padding({ left: 18, right: 18, top: 16, bottom: 12 }).width('100%')

      Scroll() {
        Column({ space: 14 }) {
          if (this.notice.length > 0) {
            Text(this.notice).fontSize(12).fontColor('#9A3D25').padding(10)
              .backgroundColor('#FFF0E8').borderRadius(12).width('100%')
          }

          this.AccountCard()

          if (this.isLoggedIn()) {
            Column({ space: 12 }) {
              Text('个人资料').fontSize(17).fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT).width('100%')
              TextInput({ text: this.editNickname, placeholder: '昵称' })
                .height(46).backgroundColor('#FFFDFC').borderRadius(13)
                .onChange((value: string) => this.editNickname = value)
              TextInput({ text: this.editHometown, placeholder: '籍贯（选填）' })
                .height(46).backgroundColor('#FFFDFC').borderRadius(13)
                .onChange((value: string) => this.editHometown = value)
              Button(this.isLoading ? '保存中…' : '保存个人资料')
                .width('100%').height(44).enabled(!this.isLoading).fontColor(Color.White)
                .backgroundColor(COLOR_PRIMARY).borderRadius(14).onClick(() => this.saveProfile())
            }
            .padding(16).backgroundColor(Color.White).borderRadius(20).width('100%')
          }

          Column({ space: 15 }) {
            Row() {
              Column({ space: 3 }) {
                Text('饮食偏好').fontSize(17).fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT)
                Text(this.isLoggedIn() ? '保存后会参与后续云端推荐' : '游客模式下仅用于当前运行')
                  .fontSize(11).fontColor(COLOR_MUTED)
              }
              .alignItems(HorizontalAlign.Start).layoutWeight(1)
              Button('编辑')
                .type(ButtonType.Normal).height(34).fontSize(12).fontColor(COLOR_PRIMARY_DARK)
                .backgroundColor('#FFF0E8').borderRadius(17).onClick(() => this.openPreferenceEditor())
            }
            .width('100%')

            this.PreferenceSummary('忌口 / 过敏原', this.profile.dietaryRestrictions)
            this.PreferenceSummary('口味偏好', this.profile.tastePreferences)
            this.PreferenceSummary('菜系偏好', this.profile.cuisinePreferences)

            Row() {
              Column({ space: 3 }) {
                Text('个性化推荐').fontSize(14).fontWeight(FontWeight.Medium).fontColor(COLOR_TEXT)
                Text('允许使用上述偏好参与排序').fontSize(11).fontColor(COLOR_MUTED)
              }
              .alignItems(HorizontalAlign.Start).layoutWeight(1)
              Text(this.profile.personalizationEnabled ? '已开启' : '已关闭')
                .fontSize(12).fontColor(this.profile.personalizationEnabled ? '#2E8B57' : COLOR_MUTED)
            }
            .padding({ top: 12 }).border({ width: { top: 1 }, color: COLOR_LINE }).width('100%')
          }
          .padding(16).backgroundColor(Color.White).borderRadius(20).width('100%')

          Column() {
            Row() {
              Column({ space: 3 }) {
                Text('隐私与安全').fontSize(15).fontWeight(FontWeight.Medium).fontColor(COLOR_TEXT)
                Text('查看个性化与数据使用说明').fontSize(11).fontColor(COLOR_MUTED)
              }
              .alignItems(HorizontalAlign.Start).layoutWeight(1)
              Text('›').fontSize(24).fontColor('#B9A9A0')
            }
            .padding({ top: 13, bottom: 13 }).width('100%')

            if (this.isLoggedIn()) {
              Row() {
                Text('退出登录').fontSize(15).fontColor('#B33A2B').layoutWeight(1)
                Text('›').fontSize(24).fontColor('#B9A9A0')
              }
              .padding({ top: 13, bottom: 13 }).border({ width: { top: 1 }, color: COLOR_LINE })
              .width('100%').onClick(() => this.logout())
            }
          }
          .padding({ left: 16, right: 16 }).backgroundColor(Color.White).borderRadius(20).width('100%')
        }
        .padding({ left: 14, right: 14, bottom: 20 })
      }
      .scrollBar(BarState.Off).layoutWeight(1)
    }
    .width('100%').height('100%').backgroundColor(COLOR_BG)
  }

  build() {
    if (this.showLogin) {
      LoginPage({
        authToken: this.authToken,
        onBack: () => this.closeLogin(),
        onLoginSuccess: (user: AuthUser) => this.loginSucceeded(user)
      })
    } else if (this.showPreferenceEditor) {
      PreferenceEditPage({
        profile: this.profile,
        authToken: this.authToken,
        onBack: () => this.closePreferenceEditor(),
        onSaved: () => this.preferencesSaved()
      })
    } else {
      this.ProfileContent()
    }
  }
}
