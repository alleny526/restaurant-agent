import { Context } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { ChatMessage, DishRecommendation, MenuItem, SessionState } from '../model/Models';

const STORE_NAME: string = 'restaurant_agent_session';
const CONVERSATION_KEY: string = 'active_conversation';

export interface PersistedConversation {
  session: SessionState;
  messages: ChatMessage[];
  recognizedMenu: MenuItem[];
  dishRecommendations: DishRecommendation[];
}

export class SessionPersistence {
  static async load(context: Context): Promise<PersistedConversation | undefined> {
    try {
      const store: preferences.Preferences = await preferences.getPreferences(context, STORE_NAME);
      const value: preferences.ValueType = await store.get(CONVERSATION_KEY, '');
      if (typeof value !== 'string' || value.length === 0) return undefined;

      const conversation: PersistedConversation = JSON.parse(value) as PersistedConversation;
      if (conversation.session === undefined || conversation.messages === undefined ||
        conversation.recognizedMenu === undefined || conversation.dishRecommendations === undefined) {
        return undefined;
      }
      return conversation;
    } catch (_error) {
      return undefined;
    }
  }

  static async save(context: Context, conversation: PersistedConversation): Promise<void> {
    try {
      const store: preferences.Preferences = await preferences.getPreferences(context, STORE_NAME);
      await store.put(CONVERSATION_KEY, JSON.stringify(conversation));
      await store.flush();
    } catch (_error) {
      // Persistence failure should not interrupt the active conversation.
    }
  }
}
