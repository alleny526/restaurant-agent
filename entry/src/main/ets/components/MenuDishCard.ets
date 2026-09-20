import { MenuItem } from '../model/Models';

@Component
export struct MenuDishCard {
  item: MenuItem = {
    id: '', name: '', category: '', price: 0, ingredients: [], confidence: 1
  };

  build() {
    Row({ space: 10 }) {
      Column() {
        Text(this.item.name.substring(0, 1))
          .fontSize(19)
          .fontWeight(FontWeight.Bold)
          .fontColor('#B46B2B')
      }
      .width(42)
      .height(42)
      .justifyContent(FlexAlign.Center)
      .alignItems(HorizontalAlign.Center)
      .borderRadius(13)
      .backgroundColor('#FFF1E3')

      Column({ space: 3 }) {
        Row() {
          Text(this.item.name)
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor('#26312B')
            .layoutWeight(1)
          Text(`¥${this.item.price}`)
            .fontSize(14)
            .fontColor('#B46B2B')
        }
        .width('100%')
        Text(`${this.item.category} · ${this.item.ingredients.join(' / ')}`)
          .fontSize(12)
          .fontColor('#6D7772')
          .maxLines(1)
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .width('100%')
    .padding(12)
    .borderRadius(16)
    .backgroundColor(Color.White)
  }
}
