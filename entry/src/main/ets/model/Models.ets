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
  reason: string;
  menuAvailable: boolean;
  menu: MenuItem[];
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
  dietaryRestrictions: string[];
  tastePreferences: string[];
  cuisinePreferences: string[];
  personalizationEnabled: boolean;
}

export interface OtpRequestResponse {
  requestId: string;
  expiresInSeconds: number;
  debugCode: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface SessionState {
  sessionId: string;
  stage: MealStage;
  selectedRestaurantId: string;
  userId: string;
}

export interface AgentRequest {
  action: string;
  message: string;
  restaurantId: string;
  menuImages: MenuImage[];
  recognizedMenu: MenuItem[];
  rating: number;
  state: SessionState;
  profile: UserProfile;
}

export interface AgentResponse {
  reply: string;
  state: SessionState;
  restaurants: Restaurant[];
  recognizedMenu: MenuItem[];
  dishRecommendations: DishRecommendation[];
  reviewSaved: boolean;
}
