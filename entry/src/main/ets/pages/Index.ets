import { Context } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { KeyboardAvoidMode, LengthMetrics } from '@kit.ArkUI';
import {
  AgentRequest,
  AgentResponse,
  ChatMessage,
  DishRecommendation,
  MealStage,
  MenuImage,
  MenuItem,
  Restaurant,
  RestaurantReview,
  SessionState,
  UserProfile,
  UserLocation
} from '../model/Models';
import { MenuImagePicker, PickedMenuImage } from '../services/MenuImagePicker';
import { RestaurantAgentApi } from '../services/RestaurantAgentApi';
import { AppConfig } from '../services/AppConfig';
import { LocationService } from '../services/LocationService';
import { PersistedConversation, SessionPersistence } from '../services/SessionPersistence';

const COLOR_PRIMARY: string = '#E95E35';
const COLOR_PRIMARY_DARK: string = '#BF3E1E';
const COLOR_TEXT: string = '#2A201C';
const COLOR_MUTED: string = '#786B64';
const COLOR_BG: string = '#FFF8F3';
const COLOR_CARD: string = '#FFFFFFFF';
const COLOR_LINE: string = '#EFE3DB';

const EMPTY_RESTAURANT: Restaurant = {
  id: '', name: '', cuisine: '', tags: [], address: '', distanceKm: 0,
  pricePerPerson: 0, rating: 0, open: false, reason: '', menuAvailable: false, menu: [], reviews: []
};

@Entry
@Component
struct Index {
  private chatScroller: Scroller = new Scroller();
  private userLocation: UserLocation | undefined = undefined;

  @State selectedTab: number = 1;
  @State inputText: string = '';
  @State searchText: string = '';
  @State selectedCuisine: string = '全部';
  @State maxDistanceKm: number = 0;
  @State maxPrice: number = 0;
  @State onlyOpen: boolean = false;
  @State isRestaurantLoading: boolean = true;
  @State isLoadingMoreRestaurants: boolean = false;
  @State isDiscoverSearching: boolean = false;
  @State serverSearchActive: boolean = false;
  @State hasMoreRestaurants: boolean = true;
  @State restaurantPage: number = 1;
  @State detailMenuExpanded: boolean = false;
  @State isLoading: boolean = false;
  @State showAllRecommendations: boolean = false;
  @State showDetail: boolean = false;
  @State detailRestaurant: Restaurant = EMPTY_RESTAURANT;
  @State restaurants: Restaurant[] = [];
  @State recommendations: Restaurant[] = [];
  @State recognizedMenu: MenuItem[] = [];
  @State dishRecommendations: DishRecommendation[] = [];
  @State selectedMenuImages: MenuImage[] = [];
  @State notice: string = '';
  @State phoneInput: string = '';
  @State codeInput: string = '';
  @State isLoggedIn: boolean = false;
  @State editNickname: string = '';
  @State editHometown: string = '';
  @State session: SessionState = {
    sessionId: `session-${Date.now()}`,
    stage: MealStage.PRE_MEAL,
    selectedRestaurantId: '',
    userId: 'guest',
    menuStatus: 'NONE',
    menuVersionId: ''
  };
  @State profile: UserProfile = {
    userId: 'guest',
    nickname: '游客',
    phone: '',
    hometown: '',
    dietaryRestrictions: ['花生'],
    tastePreferences: ['清淡'],
    cuisinePreferences: ['江浙菜'],
    personalizationEnabled: true
  };
  @State messages: ChatMessage[] = [
    {
      id: 'welcome',
      role: 'agent',
      text: '你好，我是餐厅助手。告诉我今天想吃什么，比如“清淡的江浙菜”，我会结合模型与商家库帮你筛选。',
      timestamp: Date.now(),
      restaurants: [],
      recognizedMenu: [],
      dishRecommendations: []
    }
  ];

  aboutToAppear(): void {
    this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
    this.initialize();
  }

  private async initialize(): Promise<void> {
    const context: Context | undefined = this.getUIContext().getHostContext();
    if (context !== undefined) {
      const restored: PersistedConversation | undefined = await SessionPersistence.load(context);
      if (restored !== undefined) {
        this.session = restored.session;
        this.messages = restored.messages;
        this.recognizedMenu = restored.recognizedMenu;
        this.dishRecommendations = restored.dishRecommendations;
      }
      this.userLocation = await LocationService.current(context);
    }
    await this.loadRestaurants();
  }

  private async persistConversation(): Promise<void> {
    const context: Context | undefined = this.getUIContext().getHostContext();
    if (context === undefined) return;
    await SessionPersistence.save(context, {
      session: this.session,
      messages: this.messages,
      recognizedMenu: this.recognizedMenu,
      dishRecommendations: this.dishRecommendations
    } as PersistedConversation);
  }

  private async restartConversation(): Promise<void> {
    this.session = {
      sessionId: `session-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
      stage: MealStage.PRE_MEAL,
      selectedRestaurantId: '',
      userId: this.profile.userId,
      menuStatus: 'NONE',
      menuVersionId: ''
    };
    this.messages = [{
      id: `welcome-${Date.now()}`,
      role: 'agent',
      text: '你好，我是餐厅助手。告诉我今天想吃什么，我会结合模型与商家库帮你筛选。',
      timestamp: Date.now(),
      restaurants: [],
      recognizedMenu: [],
      dishRecommendations: []
    }];
    this.recommendations = [];
    this.recognizedMenu = [];
    this.dishRecommendations = [];
    this.selectedMenuImages = [];
    this.inputText = '';
    this.notice = '';
    await this.persistConversation();
  }

  private async loadRestaurants(): Promise<void> {
    this.isRestaurantLoading = true;
    try {
      const response: AgentResponse = await RestaurantAgentApi.listRestaurants(this.userLocation, 1, 20);
      this.restaurants = response.restaurants;
      this.serverSearchActive = false;
      this.restaurantPage = 1;
      this.hasMoreRestaurants = response.hasMore === true;
      if (!this.cuisineOptions().includes(this.selectedCuisine)) this.selectedCuisine = '全部';
      if (['rest-lanxi', 'rest-heshan', 'rest-suyuan', 'rest-chuanyu', 'rest-chaoxiang', 'rest-beifang']
        .includes(this.session.selectedRestaurantId) || this.session.selectedRestaurantId.startsWith('demo-r-')) {
        this.session = {
          sessionId: this.session.sessionId,
          stage: MealStage.PRE_MEAL,
          selectedRestaurantId: '',
          userId: this.session.userId,
          menuStatus: 'NONE',
          menuVersionId: ''
        };
        this.recognizedMenu = [];
        this.dishRecommendations = [];
        this.notice = '此前选择的演示餐厅已移除，请重新选择。';
        await this.persistConversation();
      }
    } catch (error) {
      this.notice = `商家库暂不可用：${(error as Error).message}`;
    } finally {
      this.isRestaurantLoading = false;
    }
  }

  private async loadMoreRestaurants(): Promise<void> {
    if (this.isRestaurantLoading || this.isLoadingMoreRestaurants || !this.hasMoreRestaurants) return;
    this.isLoadingMoreRestaurants = true;
    try {
      const nextPage: number = this.restaurantPage + 1;
      const response: AgentResponse = await RestaurantAgentApi.listRestaurants(this.userLocation, nextPage, 20,
        this.serverSearchActive ? this.searchText.trim() : '');
      const existingIds: string[] = this.restaurants.map((item: Restaurant) => item.id);
      const appended: Restaurant[] = response.restaurants.filter((item: Restaurant) => !existingIds.includes(item.id));
      this.restaurants = this.restaurants.concat(appended);
      this.restaurantPage = nextPage;
      this.hasMoreRestaurants = response.hasMore === true;
    } catch (error) {
      this.notice = `加载更多餐厅失败：${(error as Error).message}`;
    } finally {
      this.isLoadingMoreRestaurants = false;
    }
  }

  private async searchDiscover(): Promise<void> {
    if (this.isDiscoverSearching) return;
    this.isDiscoverSearching = true;
    this.isRestaurantLoading = true;
    this.notice = '';
    const query: string = this.searchText.trim();
    try {
      const response: AgentResponse = await RestaurantAgentApi.listRestaurants(this.userLocation, 1, 20, query);
      this.restaurants = response.restaurants;
      this.recommendations = response.restaurants;
      this.restaurantPage = 1;
      this.hasMoreRestaurants = response.hasMore === true;
      this.serverSearchActive = query.length > 0;
      this.selectedCuisine = '全部';
      this.maxDistanceKm = 0;
      this.maxPrice = 0;
      this.onlyOpen = false;
    } catch (error) {
      this.notice = `搜索餐厅失败：${(error as Error).message}`;
    } finally {
      this.isDiscoverSearching = false;
      this.isRestaurantLoading = false;
    }
  }

  private mergeRestaurant(item: Restaurant | undefined): void {
    if (item === undefined || item.id.length === 0) return;
    const index: number = this.restaurants.findIndex((saved: Restaurant) => saved.id === item.id);
    if (index >= 0) {
      const updated: Restaurant[] = this.restaurants.slice();
      updated[index] = item;
      this.restaurants = updated;
    } else {
      this.restaurants = [item].concat(this.restaurants);
    }
    if (this.detailRestaurant.id === item.id) this.detailRestaurant = item;
  }

  private createRequest(action: string, message: string = '', restaurantId: string = ''): AgentRequest {
    const isMenuUpload: boolean = action === 'upload_menu';
    return {
      action,
      clientRequestId: `request-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
      message,
      restaurantId,
      menuImages: isMenuUpload ? this.selectedMenuImages : [],
      recognizedMenu: isMenuUpload ? this.recognizedMenu : [],
      rating: 0,
      location: this.userLocation,
      state: this.session,
      profile: this.profile
    } as AgentRequest;
  }

  private appendMessage(role: string, text: string, restaurants: Restaurant[] = [], recognizedMenu: MenuItem[] = [],
    dishRecommendations: DishRecommendation[] = []): void {
    const newMessage: ChatMessage = {
      id: `${role}-${Date.now()}-${this.messages.length}`,
      role,
      text,
      timestamp: Date.now(),
      restaurants,
      recognizedMenu,
      dishRecommendations
    };
    this.messages = this.messages.concat([newMessage]);
    this.persistConversation();
    setTimeout((): void => {
      this.chatScroller.scrollEdge(Edge.Bottom);
    }, 80);
  }

  private async execute(request: AgentRequest): Promise<AgentResponse | undefined> {
    if (this.isLoading) {
      return undefined;
    }
    this.isLoading = true;
    this.notice = '';
    try {
      const response: AgentResponse = await RestaurantAgentApi.execute(request);
      this.session = response.state;
      this.recommendations = response.restaurants;
      this.mergeRestaurant(response.selectedRestaurant);
      this.recognizedMenu = response.recognizedMenu;
      this.dishRecommendations = response.dishRecommendations;
      if (request.action === 'upload_menu') {
        this.selectedMenuImages = [];
      }
      if (request.action === 'select_restaurant') {
        this.messages = [];
        this.recommendations = [];
        this.selectedMenuImages = [];
      }
      this.appendMessage('agent', response.reply, response.restaurants, response.recognizedMenu,
        response.dishRecommendations);
      return response;
    } catch (error) {
      const message: string = (error as Error).message;
      this.notice = message.length > 0 ? message : '服务暂时不可用，请稍后重试。';
      return undefined;
    } finally {
      this.isLoading = false;
    }
  }

  private async sendMessage(): Promise<void> {
    const text: string = this.inputText.trim();
    if (text.length === 0 || this.isLoading || this.session.stage === MealStage.END) {
      return;
    }
    this.inputText = '';
    this.appendMessage('user', text);
    await this.execute(this.createRequest('chat', text));
  }

  private async selectRestaurant(item: Restaurant): Promise<void> {
    if (!this.canSelectRestaurant()) {
      this.notice = '已进入评价阶段，当前餐厅不能再更换。';
      return;
    }
    const response: AgentResponse | undefined = await this.execute(this.createRequest('select_restaurant', '', item.id));
    if (response !== undefined) {
      this.detailRestaurant = item;
      this.showDetail = false;
      this.showAllRecommendations = false;
      this.selectedTab = 1;
    }
  }

  private async markArrived(): Promise<void> {
    await this.execute(this.createRequest('arrive'));
  }

  private async finishMeal(): Promise<void> {
    await this.execute(this.createRequest('finish_meal'));
  }

  private async confirmMenu(): Promise<void> {
    await this.execute(this.createRequest('confirm_menu'));
  }

  private async pickMenuPhoto(): Promise<void> {
    if (this.session.selectedRestaurantId.length === 0) {
      this.notice = '请先选择餐厅，到店后再上传菜单。';
      return;
    }
    try {
      const picked: PickedMenuImage | null = await MenuImagePicker.pick();
      if (picked === null) {
        return;
      }
      this.recognizedMenu = picked.recognizedMenu;
      this.selectedMenuImages = [{
          fileName: picked.fileName,
          mimeType: picked.mimeType,
          base64: picked.base64
        } as MenuImage];
      const uploadText: string = picked.recognizedMenu.length > 0
        ? `已选择菜单照片，端侧 OCR 提取到 ${picked.recognizedMenu.length} 道菜，正在与大模型视觉结果交叉确认`
        : '已选择菜单照片，端侧 OCR 未提取到结构化菜品，正在尝试大模型图片识别';
      this.appendMessage('user', uploadText);
      await this.execute(this.createRequest('upload_menu'));
    } catch (error) {
      const businessError: BusinessError = error as BusinessError;
      if (businessError.code !== 13900012) {
        this.notice = `选择图片失败：${businessError.message}`;
      }
    }
  }

  private openDetail(item: Restaurant): void {
    this.detailRestaurant = item;
    this.detailMenuExpanded = false;
    this.showDetail = true;
  }

  private selectedRestaurant(): Restaurant | undefined {
    return this.restaurants.find((item: Restaurant) => item.id === this.session.selectedRestaurantId);
  }

  private canSelectRestaurant(): boolean {
    return this.session.stage !== MealStage.REVIEW && this.session.stage !== MealStage.END;
  }

  private canChangeRestaurant(): boolean {
    return this.session.selectedRestaurantId.length > 0 &&
      this.session.stage !== MealStage.REVIEW && this.session.stage !== MealStage.END;
  }

  private restaurantActionLabel(): string {
    return this.session.selectedRestaurantId.length > 0 ? '换选这家' : '选择这家';
  }

  private filteredRestaurants(): Restaurant[] {
    const query: string = this.serverSearchActive ? '' : this.searchText.trim().toLowerCase();
    return this.restaurants.filter((item: Restaurant) => {
      const cuisineMatched: boolean = this.selectedCuisine === '全部' || item.cuisine === this.selectedCuisine;
      const distanceMatched: boolean = this.maxDistanceKm === 0 ||
        (item.distanceKm > 0 && item.distanceKm <= this.maxDistanceKm);
      const priceMatched: boolean = this.maxPrice === 0 ||
        (item.pricePerPerson > 0 && item.pricePerPerson <= this.maxPrice);
      const openMatched: boolean = !this.onlyOpen || item.open;
      const queryMatched: boolean = query.length === 0 || item.name.toLowerCase().includes(query) ||
        item.cuisine.toLowerCase().includes(query) || item.tags.join(' ').toLowerCase().includes(query);
      return cuisineMatched && distanceMatched && priceMatched && openMatched && queryMatched;
    });
  }

  private cuisineOptions(): string[] {
    const values: string[] = ['全部'];
    this.restaurants.forEach((item: Restaurant) => {
      const value: string = item.cuisine.trim();
      if (value.length > 0 && !values.includes(value)) values.push(value);
    });
    return values;
  }

  private selectCuisine(value: string): void {
    this.selectedCuisine = value !== '全部' && this.selectedCuisine === value ? '全部' : value;
  }

  private conditionSelected(value: string): boolean {
    if (value === '全部') return this.maxDistanceKm === 0 && this.maxPrice === 0 && !this.onlyOpen;
    if (value === '1km内') return this.maxDistanceKm === 1;
    if (value === '3km内') return this.maxDistanceKm === 3;
    if (value === '¥50内') return this.maxPrice === 50;
    if (value === '¥100内') return this.maxPrice === 100;
    return value === '营业中' && this.onlyOpen;
  }

  private toggleCondition(value: string): void {
    if (value === '全部') {
      this.maxDistanceKm = 0;
      this.maxPrice = 0;
      this.onlyOpen = false;
    } else if (value === '1km内') {
      this.maxDistanceKm = this.maxDistanceKm === 1 ? 0 : 1;
    } else if (value === '3km内') {
      this.maxDistanceKm = this.maxDistanceKm === 3 ? 0 : 3;
    } else if (value === '¥50内') {
      this.maxPrice = this.maxPrice === 50 ? 0 : 50;
    } else if (value === '¥100内') {
      this.maxPrice = this.maxPrice === 100 ? 0 : 100;
    } else if (value === '营业中') {
      this.onlyOpen = !this.onlyOpen;
    }
  }

  private filterSelected(label: string, type: string): boolean {
    return type === 'cuisine' ? this.selectedCuisine === label : this.conditionSelected(label);
  }

  private stageLabel(): string {
    if (this.session.stage === MealStage.RESTAURANT_SELECTED) return '待到店';
    if (this.session.stage === MealStage.ARRIVED) return '已到店 · 待上传菜单';
    if (this.session.stage === MealStage.MENU_READY) return '菜单已就绪';
    if (this.session.stage === MealStage.DINING) return '用餐中';
    if (this.session.stage === MealStage.REVIEW) return '待评价';
    if (this.session.stage === MealStage.END) return '本次用餐已完成';
    return '餐前选店';
  }

  private togglePreference(type: string, value: string): void {
    if (type === 'restriction') {
      if (this.profile.dietaryRestrictions.includes(value)) {
        this.profile.dietaryRestrictions = this.profile.dietaryRestrictions.filter((item: string) => item !== value);
      } else {
        this.profile.dietaryRestrictions = this.profile.dietaryRestrictions.concat([value]);
      }
    } else if (type === 'taste') {
      if (this.profile.tastePreferences.includes(value)) {
        this.profile.tastePreferences = this.profile.tastePreferences.filter((item: string) => item !== value);
      } else {
        this.profile.tastePreferences = this.profile.tastePreferences.concat([value]);
      }
    } else {
      if (this.profile.cuisinePreferences.includes(value)) {
        this.profile.cuisinePreferences = this.profile.cuisinePreferences.filter((item: string) => item !== value);
      } else {
        this.profile.cuisinePreferences = this.profile.cuisinePreferences.concat([value]);
      }
    }
    this.profile = {
      userId: this.profile.userId,
      nickname: this.profile.nickname,
      phone: this.profile.phone,
      hometown: this.profile.hometown,
      dietaryRestrictions: this.profile.dietaryRestrictions,
      tastePreferences: this.profile.tastePreferences,
      cuisinePreferences: this.profile.cuisinePreferences,
      personalizationEnabled: this.profile.personalizationEnabled
    } as UserProfile;
  }

  private login(): void {
    if (!/^1\d{10}$/.test(this.phoneInput) || this.codeInput !== '123456') {
      this.notice = '开发模式请输入 11 位手机号，验证码为 123456。';
      return;
    }
    this.profile = {
      userId: `user-${this.phoneInput.substring(7)}`,
      nickname: this.editNickname.length > 0 ? this.editNickname : '餐厅用户',
      phone: this.phoneInput,
      hometown: this.editHometown,
      dietaryRestrictions: this.profile.dietaryRestrictions,
      tastePreferences: this.profile.tastePreferences,
      cuisinePreferences: this.profile.cuisinePreferences,
      personalizationEnabled: true
    } as UserProfile;
    this.session = {
      sessionId: this.session.sessionId,
      stage: this.session.stage,
      selectedRestaurantId: this.session.selectedRestaurantId,
      userId: this.profile.userId
    } as SessionState;
    this.isLoggedIn = true;
    this.notice = '登录成功。生产环境请在 AGC 启用认证服务并替换开发验证码。';
  }

  @Builder
  private PageHeader(title: string, subtitle: string) {
    Column({ space: 4 }) {
      Text(title)
        .fontSize(26)
        .fontWeight(FontWeight.Bold)
        .fontColor(COLOR_TEXT)
        .width('100%')
      Text(subtitle)
        .fontSize(13)
        .fontColor(COLOR_MUTED)
        .width('100%')
    }
    .padding({ left: 18, right: 18, top: 16, bottom: 12 })
    .width('100%')
  }

  @Builder
  private Chip(label: string, selected: boolean, click: () => void) {
    Text(label)
      .fontSize(12)
      .fontWeight(selected ? FontWeight.Medium : FontWeight.Regular)
      .fontColor(selected ? Color.White : COLOR_MUTED)
      .padding({ left: 13, right: 13, top: 7, bottom: 7 })
      .backgroundColor(selected ? COLOR_PRIMARY : '#FFF0E8')
      .borderRadius(18)
      .onClick(click)
  }

  @Builder
  private FilterChip(label: string, type: string) {
    Text(label)
      .fontSize(12)
      .fontWeight(this.filterSelected(label, type) ? FontWeight.Medium : FontWeight.Regular)
      .fontColor(this.filterSelected(label, type) ? Color.White : COLOR_MUTED)
      .padding({ left: 13, right: 13, top: 7, bottom: 7 })
      .backgroundColor(this.filterSelected(label, type) ? COLOR_PRIMARY : '#FFF0E8')
      .borderRadius(18)
      .onClick(() => {
        if (type === 'cuisine') this.selectCuisine(label);
        else this.toggleCondition(label);
      })
  }

  @Builder
  private RestaurantCard(item: Restaurant, compact: boolean) {
    Column({ space: 10 }) {
      Row({ space: 12 }) {
        Column() {
          Text(item.name.substring(0, 1))
            .fontSize(24)
            .fontWeight(FontWeight.Bold)
            .fontColor(Color.White)
        }
        .width(56)
        .height(56)
        .justifyContent(FlexAlign.Center)
        .backgroundColor(item.menuAvailable ? COLOR_PRIMARY : '#D19173')
        .borderRadius(16)

        Column({ space: 4 }) {
          Row({ space: 8 }) {
            Text(item.name)
              .fontSize(17)
              .fontWeight(FontWeight.Bold)
              .fontColor(COLOR_TEXT)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .layoutWeight(1)
            Text(item.openStatusKnown === false ? '时间待确认' : (item.open ? '营业中' : '休息中'))
              .fontSize(11)
              .fontColor(item.open && item.openStatusKnown !== false ? '#2E8B57' : COLOR_MUTED)
          }
          .width('100%')
          Text(`${item.cuisine}` +
            `${item.distanceKm > 0 ? ` · ${item.distanceKm.toFixed(1)}km` : ''}` +
            `${item.pricePerPerson > 0 ? ` · ¥${item.pricePerPerson}/人` : ' · 人均待补充'}`)
            .fontSize(13)
            .fontColor(COLOR_MUTED)
          Row({ space: 5 }) {
            if (item.rating > 0) {
              Text(`★ ${item.rating.toFixed(1)}`).fontSize(12).fontColor('#C27A00')
            }
            Text(item.tags.slice(0, 2).join(' · ')).fontSize(12).fontColor(COLOR_MUTED)
          }
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
      }
      .width('100%')

      if (!compact) {
        Text(item.reason)
          .fontSize(13)
          .fontColor(COLOR_MUTED)
          .lineHeight(20)
          .width('100%')
        Text(item.address)
          .fontSize(12)
          .fontColor('#99867D')
          .width('100%')
        if (item.menuAvailable) {
          Text(`菜单：${item.menu.slice(0, 3).map((dish: MenuItem) => dish.name).join('、')}`)
            .fontSize(12)
            .fontColor(COLOR_MUTED)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
        }
        if ((item.reviews?.length ?? 0) > 0) {
          Text(`评价：${item.reviews?.[0].text ?? ''}`)
            .fontSize(12)
            .fontColor(COLOR_MUTED)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
        }
      }

      Row({ space: 10 }) {
        Button('查看详情')
          .type(ButtonType.Normal)
          .fontSize(13)
          .height(36)
          .layoutWeight(1)
          .fontColor(COLOR_PRIMARY_DARK)
          .backgroundColor('#FFF0E8')
          .borderRadius(18)
          .onClick(() => this.openDetail(item))
        Button(this.restaurantActionLabel())
          .type(ButtonType.Normal)
          .fontSize(13)
          .height(36)
          .layoutWeight(1)
          .fontColor(this.canSelectRestaurant() ? Color.White : COLOR_MUTED)
          .backgroundColor(this.canSelectRestaurant() ? COLOR_PRIMARY : '#E6DED9')
          .borderRadius(18)
          .enabled(this.canSelectRestaurant() && !this.isLoading)
          .onClick(() => this.selectRestaurant(item))
      }
      .width('100%')
    }
    .width('100%')
    .padding(14)
    .backgroundColor(COLOR_CARD)
    .borderRadius(20)
    .border({ width: 1, color: COLOR_LINE })
  }

  @Builder
  private ChatBubble(message: ChatMessage) {
    Row() {
      if (message.role === 'user') {
        Blank()
      }
      Text(message.text)
        .fontSize(15)
        .lineHeight(22)
        .fontColor(message.role === 'user' ? Color.White : COLOR_TEXT)
        .padding({ left: 14, right: 14, top: 11, bottom: 11 })
        .backgroundColor(message.role === 'user' ? COLOR_PRIMARY : COLOR_CARD)
        .borderRadius(message.role === 'user' ? { topLeft: 18, topRight: 5, bottomLeft: 18, bottomRight: 18 } :
          { topLeft: 5, topRight: 18, bottomLeft: 18, bottomRight: 18 })
        .constraintSize({ maxWidth: '82%' })
      if (message.role !== 'user') {
        Blank()
      }
    }
    .width('100%')
  }

  @Builder
  private RecommendationPanel(items: Restaurant[]) {
    Column({ space: 10 }) {
      Text('为你推荐')
        .fontSize(16)
        .fontWeight(FontWeight.Bold)
        .fontColor(COLOR_TEXT)
        .width('100%')
      ForEach(items.slice(0, 1), (item: Restaurant) => {
        this.RestaurantCard(item, true)
      }, (item: Restaurant) => item.id)
      Button(`查看全部 ${items.length} 家`)
        .type(ButtonType.Normal)
        .width('100%')
        .fontColor(COLOR_PRIMARY_DARK)
        .backgroundColor('#FFF0E8')
        .onClick(() => {
          this.recommendations = items;
          this.showAllRecommendations = true;
        })
    }
    .padding(12)
    .backgroundColor('#F9EEE7')
    .borderRadius(18)
    .width('100%')
  }

  @Builder
  private RecognizedMenuPanel(items: MenuItem[]) {
    Column({ space: 9 }) {
      Text('已识别菜单 · 请确认')
        .fontSize(16)
        .fontWeight(FontWeight.Bold)
        .fontColor(COLOR_TEXT)
        .width('100%')
      ForEach(items, (item: MenuItem) => {
        Row() {
          Column({ space: 3 }) {
            Text(item.name).fontSize(14).fontWeight(FontWeight.Medium).fontColor(COLOR_TEXT)
            Text(`${item.category} · ${item.ingredients.length > 0 ? item.ingredients.join('、') : '食材待确认'}`)
              .fontSize(11).fontColor(COLOR_MUTED)
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          Text(item.price > 0 ? `¥${item.price}` : '价格待确认').fontSize(12).fontColor(COLOR_MUTED)
          if (item.confidence < 0.8) {
            Text('需确认')
              .fontSize(10)
              .fontColor('#B86222')
              .margin({ left: 8 })
          }
        }
        .padding(10)
        .width('100%')
        .backgroundColor(Color.White)
        .borderRadius(12)
      }, (item: MenuItem) => item.id)
      Text('过敏提示：模型识别可能存在遗漏，请以餐厅实际说明为准。')
        .fontSize(11)
        .fontColor('#A4472B')
        .width('100%')
    }
    .padding(12)
    .backgroundColor('#FFF4DD')
    .borderRadius(18)
    .width('100%')
  }

  @Builder
  private DishRecommendationPanel(items: DishRecommendation[]) {
    Column({ space: 8 }) {
      Text('个性化点菜建议').fontSize(16).fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT).width('100%')
      ForEach(items, (item: DishRecommendation) => {
        Column({ space: 4 }) {
          Text(item.name).fontSize(14).fontWeight(FontWeight.Medium).fontColor(COLOR_TEXT).width('100%')
          Text(item.reason).fontSize(12).fontColor(COLOR_MUTED).width('100%')
          Text(item.allergenWarning).fontSize(11).fontColor('#A4472B').width('100%')
        }
        .padding(10)
        .backgroundColor(Color.White)
        .borderRadius(12)
        .width('100%')
      }, (item: DishRecommendation) => item.menuItemId)
    }
    .padding(12)
    .backgroundColor('#EFF7EE')
    .borderRadius(18)
    .width('100%')
  }

  @Builder
  private SelectedRestaurantBanner() {
    if (this.session.selectedRestaurantId.length > 0) {
      Row({ space: 10 }) {
        Text('当前餐厅')
          .fontSize(11)
          .fontColor(COLOR_PRIMARY_DARK)
          .padding({ left: 8, right: 8, top: 4, bottom: 4 })
          .backgroundColor('#FFE2D3')
          .borderRadius(12)
        Column({ space: 2 }) {
          Text(this.selectedRestaurant()?.name ?? '已选择餐厅')
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor(COLOR_TEXT)
          Text(this.stageLabel()).fontSize(11).fontColor(COLOR_MUTED)
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
      }
      .width('100%')
      .padding(12)
      .backgroundColor('#FFFDFB')
      .borderRadius(16)
      .border({ width: 1, color: COLOR_LINE })
    }
  }

  @Builder
  private FlowActionButton(label: string, click: () => void) {
    Button(label)
      .type(ButtonType.Normal)
      .height(36)
      .layoutWeight(1)
      .fontSize(12)
      .fontColor(COLOR_PRIMARY_DARK)
      .backgroundColor('#FFF0E8')
      .borderRadius(18)
      .constraintSize({ minWidth: 0 })
      .onClick(click)
  }

  @Builder
  private StageActions() {
    if (this.session.stage !== MealStage.PRE_MEAL && this.session.stage !== MealStage.END) {
      Row({ space: 6 }) {
        if (this.session.stage === MealStage.RESTAURANT_SELECTED) {
          this.FlowActionButton('我已抵达', () => this.markArrived())
        }
        if (this.session.stage === MealStage.ARRIVED) {
          this.FlowActionButton('上传菜单', () => this.pickMenuPhoto())
        }
        if (this.session.stage === MealStage.MENU_READY) {
          this.FlowActionButton('继续上传', () => this.pickMenuPhoto())
          this.FlowActionButton('确认菜单', () => this.confirmMenu())
        }
        if (this.session.stage === MealStage.DINING) {
          this.FlowActionButton('继续上传', () => this.pickMenuPhoto())
          this.FlowActionButton('就餐完毕', () => this.finishMeal())
        }
        if (this.session.stage === MealStage.REVIEW) {
          this.FlowActionButton('写下体验', () => this.inputText = '味道不错，服务也很好')
        }
        if (this.canChangeRestaurant()) {
          this.FlowActionButton('换选餐厅', () => this.selectedTab = 0)
        }
      }
      .width('100%')
      .padding({ left: 14, right: 14, top: 6, bottom: 6 })
      .justifyContent(FlexAlign.Start)
    }
  }

  @Builder
  private ChatPage() {
    Column() {
      Row() {
        Column({ space: 4 }) {
          Text('餐厅助手').fontSize(26).fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT)
          Text(this.stageLabel()).fontSize(13).fontColor(COLOR_MUTED)
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        Button('新对话')
          .type(ButtonType.Normal)
          .height(36)
          .fontSize(12)
          .fontColor(COLOR_PRIMARY_DARK)
          .backgroundColor('#FFF0E8')
          .borderRadius(18)
          .onClick(() => this.restartConversation())
      }
      .width('100%')
      .padding({ left: 18, right: 18, top: 16, bottom: 12 })

      if (this.notice.length > 0) {
        Text(this.notice)
          .fontSize(12)
          .fontColor('#9A3D25')
          .padding(9)
          .margin({ left: 14, right: 14, bottom: 6 })
          .backgroundColor('#FFF0E8')
          .borderRadius(12)
          .width('92%')
      }

      Scroll(this.chatScroller) {
        Column({ space: 12 }) {
          this.SelectedRestaurantBanner()
          ForEach(this.messages, (message: ChatMessage) => {
            if (message.restaurants.length > 0) {
              this.RecommendationPanel(message.restaurants)
            }
            if (message.recognizedMenu.length > 0) {
              this.RecognizedMenuPanel(message.recognizedMenu)
            }
            if (message.dishRecommendations.length > 0) {
              this.DishRecommendationPanel(message.dishRecommendations)
            }
            this.ChatBubble(message)
          }, (message: ChatMessage) => message.id)
        }
        .padding({ left: 14, right: 14, top: 10, bottom: 16 })
        .width('100%')
      }
      .scrollBar(BarState.Off)
      .layoutWeight(1)
      .width('100%')

      if (this.isLoading) {
        Row({ space: 7 }) {
          LoadingProgress().width(16).height(16).color(COLOR_PRIMARY)
          Text('助手正在处理…').fontSize(12).fontColor(COLOR_MUTED)
        }
        .padding({ left: 16, right: 16, top: 5, bottom: 3 })
        .width('100%')
      }

      this.StageActions()

      Row({ space: 8 }) {
        Button('+')
          .type(ButtonType.Circle)
          .width(42)
          .height(42)
          .fontSize(22)
          .fontColor(this.session.stage === MealStage.ARRIVED || this.session.stage === MealStage.MENU_READY ||
            this.session.stage === MealStage.DINING ? COLOR_PRIMARY_DARK : '#AFA39D')
          .backgroundColor(this.session.stage === MealStage.ARRIVED || this.session.stage === MealStage.MENU_READY ||
            this.session.stage === MealStage.DINING ? '#FFF0E8' : '#F0EBE8')
          .enabled((this.session.stage === MealStage.ARRIVED || this.session.stage === MealStage.MENU_READY ||
            this.session.stage === MealStage.DINING) && !this.isLoading)
          .onClick(() => this.pickMenuPhoto())
        TextInput({ text: this.inputText, placeholder: this.session.stage === MealStage.END ?
          '本次用餐已完成，请点击“新对话”' : (this.session.stage === MealStage.REVIEW ?
          '说说味道、服务、环境…' : '告诉助手你想吃什么…') })
          .layoutWeight(1)
          .height(44)
          .fontSize(14)
          .backgroundColor(Color.White)
          .borderRadius(22)
          .enabled(this.session.stage !== MealStage.END && !this.isLoading)
          .onChange((value: string) => this.inputText = value)
          .onFocus(() => {
            setTimeout((): void => this.chatScroller.scrollEdge(Edge.Bottom), 120);
          })
          .onSubmit(() => this.sendMessage())
        Button(this.isLoading ? '处理中' : '发送')
          .type(ButtonType.Normal)
          .width(72)
          .height(42)
          .fontSize(13)
          .fontColor(Color.White)
          .backgroundColor(this.inputText.trim().length > 0 && !this.isLoading &&
            this.session.stage !== MealStage.END ? COLOR_PRIMARY : '#D6A491')
          .borderRadius(21)
          .enabled(this.inputText.trim().length > 0 && !this.isLoading && this.session.stage !== MealStage.END)
          .onClick(() => this.sendMessage())
      }
      .padding({ left: 12, right: 12, top: 8, bottom: 8 })
      .width('100%')
      .backgroundColor('#FFFDFC')
    }
    .height('100%')
    .width('100%')
  }

  @Builder
  private DiscoverPage() {
    Column() {
      this.PageHeader('发现餐厅', '主动浏览，也可以交给助手帮你缩小选择')
      Row({ space: 8 }) {
        TextInput({ text: this.searchText, placeholder: '搜索餐厅、菜系或标签' })
          .layoutWeight(1)
          .height(42)
          .backgroundColor(Color.White)
          .borderRadius(20)
          .onChange((value: string) => this.searchText = value)
        Button('搜索')
          .height(40)
          .fontSize(13)
          .fontColor(Color.White)
          .backgroundColor(COLOR_PRIMARY)
          .enabled(!this.isDiscoverSearching)
          .onClick(() => this.searchDiscover())
      }
      .padding({ left: 14, right: 14, bottom: 10 })
      .width('100%')

      Scroll() {
        Row({ space: 8 }) {
          ForEach(this.cuisineOptions(), (value: string) => {
            this.FilterChip(value, 'cuisine')
          }, (value: string) => `cuisine-${value}`)
        }
        .padding({ left: 14, right: 14 })
      }
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
      .width('100%')
      .height(44)

      Scroll() {
        Row({ space: 8 }) {
          ForEach(['全部', '1km内', '3km内', '¥50内', '¥100内', '营业中'], (value: string) => {
            this.FilterChip(value, 'condition')
          }, (value: string) => `condition-${value}`)
        }
        .padding({ left: 14, right: 14 })
      }
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
      .width('100%')
      .height(42)

      List({ space: 12 }) {
        if (this.filteredRestaurants().length === 0) {
          ListItem() {
            Text(this.isRestaurantLoading ? '正在加载餐厅' :
              (this.restaurants.length === 0 ? '暂无餐厅数据' : '没有符合当前筛选的餐厅'))
              .fontSize(14)
              .fontColor(COLOR_MUTED)
              .textAlign(TextAlign.Center)
              .width('100%')
              .padding({ top: 48, bottom: 48 })
          }
        } else {
          ForEach(this.filteredRestaurants(), (item: Restaurant) => {
            ListItem() {
              this.RestaurantCard(item, false)
            }
          }, (item: Restaurant) => item.id)
        }
        if (this.isLoadingMoreRestaurants) {
          ListItem() {
            Text('正在加载更多餐厅').fontSize(12).fontColor(COLOR_MUTED).textAlign(TextAlign.Center)
              .width('100%').padding({ top: 14, bottom: 14 })
          }
        } else if (!this.hasMoreRestaurants && this.restaurants.length > 0) {
          ListItem() {
            Text('已加载全部餐厅').fontSize(12).fontColor(COLOR_MUTED).textAlign(TextAlign.Center)
              .width('100%').padding({ top: 14, bottom: 14 })
          }
        }
      }
      .padding({ left: 14, right: 14, top: 6, bottom: 16 })
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .width('100%')
      .onReachEnd(() => this.loadMoreRestaurants())
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  private PreferenceSection(title: string, type: string, values: string[], selected: string[]) {
    Column({ space: 8 }) {
      Text(title).fontSize(14).fontWeight(FontWeight.Medium).fontColor(COLOR_TEXT).width('100%')
      Flex({ wrap: FlexWrap.Wrap, space: { main: LengthMetrics.vp(8), cross: LengthMetrics.vp(8) } }) {
        ForEach(values, (value: string) => {
          this.Chip(value, selected.includes(value), () => this.togglePreference(type, value))
        })
      }
      .width('100%')
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
  }

  @Builder
  private ProfilePage() {
    Column() {
      this.PageHeader('我的', '偏好可选填，未登录也能使用基础推荐')
      Scroll() {
        Column({ space: 14 }) {
          if (!this.isLoggedIn) {
            Column({ space: 10 }) {
              Text('手机号登录 / 注册').fontSize(18).fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT).width('100%')
              TextInput({ text: this.phoneInput, placeholder: '请输入手机号' })
                .type(InputType.PhoneNumber)
                .onChange((value: string) => this.phoneInput = value)
              TextInput({ text: this.codeInput, placeholder: '开发验证码：123456' })
                .type(InputType.Number)
                .onChange((value: string) => this.codeInput = value)
              Button('登录 / 注册')
                .width('100%')
                .backgroundColor(COLOR_PRIMARY)
                .onClick(() => this.login())
              Text('生产环境需启用 AGC 认证服务，不应保留固定验证码。')
                .fontSize(11).fontColor(COLOR_MUTED).width('100%')
            }
            .padding(16)
            .backgroundColor(Color.White)
            .borderRadius(20)
            .width('100%')
          } else {
            Row({ space: 12 }) {
              Text(this.profile.nickname.substring(0, 1))
                .fontSize(24).fontWeight(FontWeight.Bold).fontColor(Color.White)
                .width(52).height(52).textAlign(TextAlign.Center)
                .backgroundColor(COLOR_PRIMARY).borderRadius(26)
              Column({ space: 3 }) {
                Text(this.profile.nickname).fontSize(18).fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT)
                Text(this.profile.phone).fontSize(12).fontColor(COLOR_MUTED)
              }
              .alignItems(HorizontalAlign.Start)
            }
            .padding(16)
            .backgroundColor(Color.White)
            .borderRadius(20)
            .width('100%')
          }

          Column({ space: 14 }) {
            Text('饮食偏好').fontSize(18).fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT).width('100%')
            this.PreferenceSection('忌口 / 过敏原', 'restriction', ['花生', '海鲜', '乳制品', '牛肉'],
              this.profile.dietaryRestrictions)
            this.PreferenceSection('口味偏好', 'taste', ['清淡', '少油', '微辣', '鲜香'],
              this.profile.tastePreferences)
            this.PreferenceSection('菜系偏好', 'cuisine', ['江浙菜', '杭帮菜', '粤菜', '川菜', '素食'],
              this.profile.cuisinePreferences)
            Row() {
              Column({ space: 3 }) {
                Text('个性化推荐').fontSize(14).fontWeight(FontWeight.Medium).fontColor(COLOR_TEXT)
                Text('允许使用上述偏好参与排序').fontSize(11).fontColor(COLOR_MUTED)
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: this.profile.personalizationEnabled })
                .selectedColor(COLOR_PRIMARY)
                .onChange((value: boolean) => {
                  this.profile.personalizationEnabled = value;
                  this.profile = {
                    userId: this.profile.userId,
                    nickname: this.profile.nickname,
                    phone: this.profile.phone,
                    hometown: this.profile.hometown,
                    dietaryRestrictions: this.profile.dietaryRestrictions,
                    tastePreferences: this.profile.tastePreferences,
                    cuisinePreferences: this.profile.cuisinePreferences,
                    personalizationEnabled: value
                  } as UserProfile;
                })
            }
            .width('100%')
          }
          .padding(16)
          .backgroundColor(Color.White)
          .borderRadius(20)
          .width('100%')

          Column({ space: 8 }) {
            Text('隐私与安全').fontSize(16).fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT).width('100%')
            Text('菜单识别可能遗漏过敏原；系统不会把模型猜测当作食材事实。你可以关闭个性化推荐，并在生产版本中申请删除个人数据。')
              .fontSize(12).lineHeight(19).fontColor(COLOR_MUTED).width('100%')
          }
          .padding(16)
          .backgroundColor('#FFF4DD')
          .borderRadius(18)
          .width('100%')
        }
        .padding({ left: 14, right: 14, bottom: 20 })
      }
      .scrollBar(BarState.Off)
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  private DetailPage() {
    Column() {
      Row({ space: 12 }) {
        Button('‹').type(ButtonType.Circle).width(38).height(38).fontSize(24)
          .fontColor(COLOR_TEXT).backgroundColor('#FFF0E8').onClick(() => this.showDetail = false)
        Text('商家详情').fontSize(20).fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT).layoutWeight(1)
      }
      .padding({ left: 14, right: 14, top: 14, bottom: 10 })
      .width('100%')

      Scroll() {
        Column({ space: 16 }) {
          Column({ space: 8 }) {
            Text(this.detailRestaurant.name).fontSize(28).fontWeight(FontWeight.Bold).fontColor(Color.White).width('100%')
            Text(`${this.detailRestaurant.cuisine}` +
              `${this.detailRestaurant.rating > 0 ? ` · ★ ${this.detailRestaurant.rating.toFixed(1)}` : ''}` +
              `${this.detailRestaurant.pricePerPerson > 0 ? ` · ¥${this.detailRestaurant.pricePerPerson}/人` : ' · 人均待补充'}`)
              .fontSize(14).fontColor('#FFF4EE').width('100%')
            Text(this.detailRestaurant.address).fontSize(12).fontColor('#FFF4EE').width('100%')
          }
          .padding(22)
          .height(150)
          .justifyContent(FlexAlign.End)
          .backgroundColor(COLOR_PRIMARY)
          .borderRadius(24)
          .width('100%')

          Column({ space: 8 }) {
            Text('推荐理由').fontSize(16).fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT).width('100%')
            Text(this.detailRestaurant.reason).fontSize(14).lineHeight(21).fontColor(COLOR_MUTED).width('100%')
          }
          .padding(16).backgroundColor(Color.White).borderRadius(18).width('100%')

          Column({ space: 9 }) {
            Row() {
              Text(`菜单${this.detailRestaurant.menuAvailable ? ` (${this.detailRestaurant.menu.length})` : ''}`)
                .fontSize(16).fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT).layoutWeight(1)
              if (this.detailRestaurant.menuAvailable) {
                Button(this.detailMenuExpanded ? '收起' : '展开')
                  .type(ButtonType.Normal)
                  .height(30)
                  .fontSize(12)
                  .fontColor(COLOR_PRIMARY_DARK)
                  .backgroundColor('#FFF0E8')
                  .onClick(() => this.detailMenuExpanded = !this.detailMenuExpanded)
              }
            }
            .width('100%')
            if (!this.detailRestaurant.menuAvailable) {
              Text('暂无菜单，抵达后可拍照让助手帮你选菜。').fontSize(13).fontColor(COLOR_MUTED).width('100%')
            } else if (this.detailMenuExpanded) {
              ForEach(this.detailRestaurant.menu, (item: MenuItem) => {
                Row() {
                  Column({ space: 3 }) {
                    Text(item.name).fontSize(14).fontWeight(FontWeight.Medium).fontColor(COLOR_TEXT)
                    Text(item.ingredients.join('、')).fontSize(11).fontColor(COLOR_MUTED)
                  }
                  .alignItems(HorizontalAlign.Start)
                  .layoutWeight(1)
                  Text(`¥${item.price}`).fontSize(13).fontColor(COLOR_PRIMARY_DARK)
                }
                .padding({ top: 8, bottom: 8 })
                .width('100%')
              }, (item: MenuItem) => item.id)
            }
          }
          .padding(16).backgroundColor(Color.White).borderRadius(18).width('100%')

          Column({ space: 10 }) {
            Text(`用餐评价 (${this.detailRestaurant.reviews?.length ?? 0})`)
              .fontSize(16).fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT).width('100%')
            if ((this.detailRestaurant.reviews?.length ?? 0) === 0) {
              Text('暂无用餐评价').fontSize(13).fontColor(COLOR_MUTED).width('100%')
            } else {
              ForEach(this.detailRestaurant.reviews ?? [], (review: RestaurantReview) => {
                Column({ space: 5 }) {
                  Row() {
                    if (review.rating > 0) {
                      Text(`★ ${review.rating.toFixed(1)}`).fontSize(12).fontColor('#B36B00')
                    }
                    Blank()
                    Text(review.createdAt.substring(0, 10)).fontSize(11).fontColor(COLOR_MUTED)
                  }
                  .width('100%')
                  Text(review.text).fontSize(13).lineHeight(20).fontColor(COLOR_TEXT).width('100%')
                }
                .padding({ top: 9, bottom: 9 })
                .border({ width: { bottom: 1 }, color: COLOR_LINE })
                .width('100%')
              }, (review: RestaurantReview) => review.id)
            }
          }
          .padding(16).backgroundColor(Color.White).borderRadius(18).width('100%')
        }
        .padding({ left: 14, right: 14, bottom: 18 })
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)

      Button(this.restaurantActionLabel())
        .height(48)
        .width('92%')
        .fontSize(16)
        .fontColor(this.canSelectRestaurant() ? Color.White : COLOR_MUTED)
        .backgroundColor(this.canSelectRestaurant() ? COLOR_PRIMARY : '#E6DED9')
        .enabled(this.canSelectRestaurant() && !this.isLoading)
        .margin({ bottom: 12 })
        .onClick(() => this.selectRestaurant(this.detailRestaurant))
    }
    .width('100%')
    .height('100%')
    .backgroundColor(COLOR_BG)
  }

  @Builder
  private AllRecommendationsPage() {
    Column() {
      Row({ space: 12 }) {
        Button('‹').type(ButtonType.Circle).width(38).height(38).fontSize(24)
          .fontColor(COLOR_TEXT).backgroundColor('#FFF0E8').onClick(() => this.showAllRecommendations = false)
        Column({ space: 2 }) {
          Text('全部推荐').fontSize(20).fontWeight(FontWeight.Bold).fontColor(COLOR_TEXT)
          Text('保持当前条件与排序').fontSize(11).fontColor(COLOR_MUTED)
        }
        .alignItems(HorizontalAlign.Start)
      }
      .padding(14)
      .width('100%')
      List({ space: 12 }) {
        ForEach(this.recommendations, (item: Restaurant) => {
          ListItem() { this.RestaurantCard(item, false) }
        }, (item: Restaurant) => item.id)
      }
      .padding({ left: 14, right: 14, bottom: 16 })
      .layoutWeight(1)
      .scrollBar(BarState.Off)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(COLOR_BG)
  }

  @Builder
  private BottomNavigation() {
    Row() {
      this.NavItem('发现', 0, '⌕')
      this.NavItem('对话', 1, '◉')
      this.NavItem('我的', 2, '○')
    }
    .height(64)
    .width('100%')
    .backgroundColor('#FFFDFC')
    .border({ width: { top: 1 }, color: COLOR_LINE })
  }

  @Builder
  private NavItem(label: string, index: number, icon: string) {
    Column({ space: 2 }) {
      Text(icon).fontSize(20).fontColor(this.selectedTab === index ? COLOR_PRIMARY : '#A18F86')
      Text(label).fontSize(11).fontColor(this.selectedTab === index ? COLOR_PRIMARY_DARK : COLOR_MUTED)
    }
    .layoutWeight(1)
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .onClick(() => this.selectedTab = index)
  }

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column() {
        Column() {
          if (this.selectedTab === 0) {
            this.DiscoverPage()
          } else if (this.selectedTab === 1) {
            this.ChatPage()
          } else {
            this.ProfilePage()
          }
        }
        .layoutWeight(1)
        .width('100%')
        this.BottomNavigation()
      }
      .width('100%')
      .height('100%')
      .backgroundColor(COLOR_BG)

      if (this.showAllRecommendations) {
        this.AllRecommendationsPage()
      }
      if (this.showDetail) {
        this.DetailPage()
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(COLOR_BG)
  }
}
