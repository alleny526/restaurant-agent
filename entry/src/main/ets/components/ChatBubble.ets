import { ChatMessage } from '../model/Models';

@Component
export struct ChatBubble {
  message: ChatMessage = {
    id: '', role: 'agent', text: '', timestamp: 0,
    restaurants: [], recognizedMenu: [], dishRecommendations: []
  };

  build() {
    Row() {
      if (this.message.role === 'user') {
        Blank()
      }
      Column() {
        Text(this.message.text)
          .fontSize(15)
          .fontColor(this.message.role === 'user' ? Color.White : '#26312B')
          .lineHeight(22)
      }
      .alignItems(HorizontalAlign.Start)
      .padding({ left: 14, right: 14, top: 11, bottom: 11 })
      .borderRadius(this.message.role === 'user' ? 18 : 20)
      .backgroundColor(this.message.role === 'user' ? '#16785A' : Color.White)
      .constraintSize({ maxWidth: '82%' })
      if (this.message.role !== 'user') {
        Blank()
      }
    }
    .width('100%')
    .padding({ left: 2, right: 2 })
  }
}
