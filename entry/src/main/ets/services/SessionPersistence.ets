import { Context } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { ChatMessage, DishRecommendation, MenuItem, SessionState } from '../model/Models';

export interface PersistedConversation {
  session: SessionState;
  messages: ChatMessage[];
  recognizedMenu: MenuItem[];
  dishRecommendations: DishRecommendation[];
}

export class SessionPersistence {
  private static readonly FILE_NAME: string = 'restaurant_agent_state';
  private static readonly KEY: string = 'active_conversation';

  static async load(context: Context): Promise<PersistedConversation | undefined> {
    try {
      const store = await preferences.getPreferences(context, SessionPersistence.FILE_NAME);
      const value = await store.get(SessionPersistence.KEY, '');
      if (typeof value !== 'string' || value.length === 0) return undefined;
      const parsed = JSON.parse(value) as PersistedConversation;
      if (parsed.session === undefined || parsed.session.sessionId.length === 0) return undefined;
      return parsed;
    } catch (_error) {
      return undefined;
    }
  }

  static async save(context: Context, value: PersistedConversation): Promise<void> {
    try {
      const store = await preferences.getPreferences(context, SessionPersistence.FILE_NAME);
      await store.put(SessionPersistence.KEY, JSON.stringify(value));
      await store.flush();
    } catch (_error) {
    }
  }
}
