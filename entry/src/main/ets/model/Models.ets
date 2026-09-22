export enum MealStage {
  PRE_MEAL = 'PRE_MEAL',
  RESTAURANT_SELECTED = 'RESTAURANT_SELECTED',
  ARRIVED = 'ARRIVED',
  MENU_READY = 'MENU_READY',
  DINING = 'DINING',
  DINING_DONE = 'DINING_DONE',
  REVIEW = 'REVIEW',
  END = 'END'
}

export interface MenuItem {
  id: string;
  name: string;
  category: string;
  price: number;
  ingredients: string[];
  confidence: number;
}

export interface MenuImage {
  fileName: string;
  mimeType: string;
  base64: string;
}

export interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  tags: string[];
  address: string;
  distanceKm: number;
  pricePerPerson: number;
  rating: number;
  open: boolean;
  openStatusKnown?: boolean;
  openingHours?: string;
  source?: string;
  reason: string;
  menuAvailable: boolean;
  menu: MenuItem[];
  reviews?: RestaurantReview[];
  imageUrl?: string;
  images?: RestaurantPhoto[];
}

export interface RestaurantPhoto {
  title: string;
  url: string;
  menuCandidate: boolean;
}

export interface RestaurantReview {
  id: string;
  rating: number;
  text: string;
  tags: string[];
  createdAt: string;
  authorName?: string;
}

export interface DishRecommendation {
  menuItemId: string;
  name: string;
  reason: string;
  allergenWarning: string;
}

export interface ChatMessage {
  id: string;
  role: string;
  text: string;
  timestamp: number;
  restaurants: Restaurant[];
  recognizedMenu: MenuItem[];
  dishRecommendations: DishRecommendation[];
}

export interface UserProfile {
  userId: string;
  nickname: string;
  phone: string;
  hometown: string;
  avatarUrl: string;
  dietaryRestrictions: string[];
  tastePreferences: string[];
  cuisinePreferences: string[];
  personalizationEnabled: boolean;
}

export interface AuthUser {
  id: string;
  phone: string;
  nickname: string;
  hometown: string;
  avatarUrl: string;
  dietaryRestrictions: string[];
  tastePreferences: string[];
  cuisinePreferences: string[];
  personalizationEnabled: boolean;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface UserLocation {
  longitude: number;
  latitude: number;
}

export interface SessionState {
  sessionId: string;
  stage: MealStage;
  selectedRestaurantId: string;
  userId: string;
  menuStatus?: string;
  menuVersionId?: string;
}

export interface AgentRequest {
  action: string;
  clientRequestId: string;
  message: string;
  restaurantId: string;
  menuImages: MenuImage[];
  recognizedMenu: MenuItem[];
  rating: number;
  state: SessionState;
  profile: UserProfile;
  location?: UserLocation;
  page?: number;
  pageSize?: number;
}

export interface AgentResponse {
  reply: string;
  state: SessionState;
  restaurants: Restaurant[];
  recognizedMenu: MenuItem[];
  dishRecommendations: DishRecommendation[];
  reviewSaved: boolean;
  modelUsed?: boolean;
  selectedRestaurant?: Restaurant;
  hasMore?: boolean;
  nextPage?: number;
}
