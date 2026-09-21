import { LengthMetrics } from '@kit.ArkUI';
import { AuthUser, UserProfile } from '../model/Models';
import { AuthApi } from '../services/AuthApi';

const COLOR_PRIMARY: string = '#E95E35';
const COLOR_PRIMARY_DARK: string = '#BF3E1E';
const COLOR_TEXT: string = '#2A201C';
const COLOR_MUTED: string = '#786B64';
const COLOR_LINE: string = '#EFE3DB';
const COLOR_BG: string = '#FFF8F3';

interface PreferenceOptionState {
  label: string;
  selected: boolean;
}

@Component
struct PreferenceSectionView {
  @Link options: PreferenceOptionState[];
  title: string = '';
  description: string = '';

  private toggle(label: string): void {
    this.options = this.options.map((item: PreferenceOptionState) => {
      return {
        label: item.label,
        selected: item.label === label ? !item.selected : item.selected
      } as PreferenceOptionState;
    });
  }

  build() {
    Column({ space: 13 }) {
      Column({ space: 4 }) {
        Row() {
          Text(this.title).fontSize(17).fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT).layoutWeight(1)
          Text(`${this.options.filter((item: PreferenceOptionState) => item.selected).length} 项已选`)
            .fontSize(11).fontColor(COLOR_PRIMARY_DARK)
        }
        .width('100%')
        Text(this.description).fontSize(12).lineHeight(18).fontColor(COLOR_MUTED).width('100%')
      }
      .alignItems(HorizontalAlign.Start).width('100%')

      Flex({ wrap: FlexWrap.Wrap, space: { main: LengthMetrics.vp(9), cross: LengthMetrics.vp(9) } }) {
        ForEach(this.options, (option: PreferenceOptionState) => {
          Button(option.selected ? `✓ ${option.label}` : option.label)
            .type(ButtonType.Normal).height(38).fontSize(13)
            .fontWeight(option.selected ? FontWeight.Medium : FontWeight.Regular)
            .fontColor(option.selected ? Color.White : COLOR_TEXT)
            .backgroundColor(option.selected ? COLOR_PRIMARY : '#FFFDFC')
            .border({ width: 1, color: option.selected ? COLOR_PRIMARY : COLOR_LINE })
            .borderRadius(19).onClick(() => this.toggle(option.label))
        }, (option: PreferenceOptionState) => `${option.label}-${option.selected ? 'selected' : 'unselected'}`)
      }
      .width('100%')
    }
    .padding(17).backgroundColor(Color.White).borderRadius(20).width('100%')
  }
}

@Component
export struct PreferenceEditPage {
  @Link profile: UserProfile;
  authToken: string = '';
  onBack: () => void = () => {};
  onSaved: () => void = () => {};

  @State restrictionOptions: PreferenceOptionState[] = [];
  @State tasteOptions: PreferenceOptionState[] = [];
  @State cuisineOptions: PreferenceOptionState[] = [];
  @State personalizationEnabled: boolean = true;
  @State isSaving: boolean = false;
  @State notice: string = '';

  aboutToAppear(): void {
    this.restrictionOptions = this.createOptions(['花生', '海鲜', '乳制品', '牛肉', '鸡蛋', '坚果', '麸质'],
      this.profile.dietaryRestrictions);
    this.tasteOptions = this.createOptions(['清淡', '少油', '少盐', '微辣', '中辣', '麻辣', '鲜香', '酸甜'],
      this.profile.tastePreferences);
    this.cuisineOptions = this.createOptions(
      ['江浙菜', '杭帮菜', '粤菜', '川菜', '湘菜', '鲁菜', '西北菜', '素食', '日料', '西餐'],
      this.profile.cuisinePreferences);
    this.personalizationEnabled = this.profile.personalizationEnabled;
  }

  private createOptions(labels: string[], selected: string[]): PreferenceOptionState[] {
    return labels.map((label: string) => {
      return { label, selected: selected.includes(label) } as PreferenceOptionState;
    });
  }

  private selectedValues(options: PreferenceOptionState[]): string[] {
    return options.filter((item: PreferenceOptionState) => item.selected)
      .map((item: PreferenceOptionState) => item.label);
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
  }

  private async save(): Promise<void> {
    const updated: UserProfile = {
      userId: this.profile.userId,
      nickname: this.profile.nickname,
      phone: this.profile.phone,
      hometown: this.profile.hometown,
      dietaryRestrictions: this.selectedValues(this.restrictionOptions),
      tastePreferences: this.selectedValues(this.tasteOptions),
      cuisinePreferences: this.selectedValues(this.cuisineOptions),
      personalizationEnabled: this.personalizationEnabled
    } as UserProfile;
    this.isSaving = true;
    this.notice = '';
    let saved: boolean = false;
    try {
      if (this.authToken.length > 0 && this.profile.userId !== 'guest') {
        this.applyUser(await AuthApi.updateProfile(this.authToken, updated));
      } else {
        this.profile = updated;
      }
      saved = true;
    } catch (error) {
      this.notice = (error as Error).message;
    } finally {
      this.isSaving = false;
    }
    if (saved) this.onSaved();
  }

  build() {
    Column() {
      Row({ space: 12 }) {
        Button('‹').type(ButtonType.Circle).width(40).height(40).fontSize(26)
          .fontColor(COLOR_TEXT).backgroundColor(Color.Transparent).onClick(() => this.onBack())
        Column({ space: 2 }) {
          Text('饮食偏好').fontSize(21).fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT)
          Text('选择结果会用于个性化推荐').fontSize(11).fontColor(COLOR_MUTED)
        }
        .alignItems(HorizontalAlign.Start).layoutWeight(1)
      }
      .width('100%').padding({ left: 12, right: 18, top: 12, bottom: 10 })
      .backgroundColor('#FFFDFC')

      Scroll() {
        Column({ space: 14 }) {
          if (this.notice.length > 0) {
            Text(this.notice).fontSize(12).lineHeight(18).fontColor('#9A3D25')
              .padding(11).backgroundColor('#FFF0E8').borderRadius(12).width('100%')
          }

          PreferenceSectionView({
            options: this.restrictionOptions,
            title: '忌口与过敏原',
            description: '可多选；没有特殊忌口时可以保持为空。'
          })
          PreferenceSectionView({
            options: this.tasteOptions,
            title: '口味偏好',
            description: '选择平时更喜欢的味型，可同时选择多个。'
          })
          PreferenceSectionView({
            options: this.cuisineOptions,
            title: '菜系偏好',
            description: '推荐餐厅时会优先参考已选择的菜系。'
          })

          Row() {
            Column({ space: 4 }) {
              Text('开启个性化推荐').fontSize(16).fontWeight(FontWeight.Medium).fontColor(COLOR_TEXT)
              Text('允许使用上述偏好调整餐厅和菜品排序').fontSize(11).fontColor(COLOR_MUTED)
            }
            .alignItems(HorizontalAlign.Start).layoutWeight(1)
            Toggle({ type: ToggleType.Switch, isOn: this.personalizationEnabled })
              .selectedColor(COLOR_PRIMARY)
              .onChange((value: boolean) => this.personalizationEnabled = value)
          }
          .padding(17).backgroundColor(Color.White).borderRadius(20).width('100%')
        }
        .padding({ left: 14, right: 14, top: 12, bottom: 20 })
      }
      .layoutWeight(1).width('100%').scrollBar(BarState.Off)

      Column({ space: 8 }) {
        Button(this.isSaving ? '保存中…' : '保存偏好')
          .width('100%').height(48).enabled(!this.isSaving)
          .fontSize(16).fontWeight(FontWeight.Medium).fontColor(Color.White)
          .backgroundColor(COLOR_PRIMARY).borderRadius(16).onClick(() => this.save())
        Text(this.authToken.length > 0 ? '保存后将同步到你的账号' : '游客模式下仅保存在本次运行中')
          .fontSize(10).fontColor(COLOR_MUTED)
      }
      .padding({ left: 18, right: 18, top: 12, bottom: 16 }).width('100%')
      .backgroundColor('#FFFDFC').border({ width: { top: 1 }, color: COLOR_LINE })
    }
    .width('100%').height('100%').backgroundColor(COLOR_BG)
  }
}
