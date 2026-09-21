import { Restaurant } from '../model/Models';

@Component
export struct RestaurantCard {
  restaurant: Restaurant = {
    id: '', name: '', cuisine: '', tags: [], address: '', distanceKm: 0, pricePerPerson: 0,
    rating: 0, open: false, reason: '', menuAvailable: false, menu: []
  };
  compact: boolean = false;
  showSelect: boolean = true;
  onDetail: (restaurant: Restaurant) => void = () => {};
  onSelect: (restaurant: Restaurant) => void = () => {};

  private distanceLabel(): string {
    if (this.restaurant.distanceKm < 1) {
      return `${Math.round(this.restaurant.distanceKm * 1000)}m`;
    }
    return `${this.restaurant.distanceKm.toFixed(1)}km`;
  }

  build() {
    Column({ space: 10 }) {
      Row({ space: 12 }) {
        Column() {
          Text(this.restaurant.name.substring(0, 1))
            .fontSize(24)
            .fontWeight(FontWeight.Bold)
            .fontColor('#16785A')
        }
        .width(54)
        .height(54)
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Center)
        .borderRadius(18)
        .backgroundColor('#DFF5EA')

        Column({ space: 4 }) {
          Row() {
            Text(this.restaurant.name)
              .fontSize(17)
              .fontWeight(FontWeight.Bold)
              .fontColor('#1B2520')
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .layoutWeight(1)
            Text(this.restaurant.openStatusKnown === false ? '时间待确认' :
              (this.restaurant.open ? '营业中' : '休息中'))
              .fontSize(11)
              .fontColor(this.restaurant.open && this.restaurant.openStatusKnown !== false ? '#16785A' : '#8A8F8C')
          }
          .width('100%')

          Text(`${this.restaurant.cuisine}  ${this.restaurant.pricePerPerson > 0 ?
            `¥${this.restaurant.pricePerPerson}/人` : '人均待补充'}`)
            .fontSize(13)
            .fontColor('#5F6964')
            .maxLines(1)
          Text(`${this.restaurant.rating > 0 ? `★ ${this.restaurant.rating.toFixed(1)}  ·  ` : ''}` +
            `${this.restaurant.distanceKm > 0 ? `${this.distanceLabel()}  ·  ` : ''}${this.restaurant.address}`)
            .fontSize(12)
            .fontColor('#7D8681')
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
      }
      .width('100%')

      if (this.restaurant.reason.length > 0) {
        Text(this.restaurant.reason)
          .fontSize(13)
          .fontColor('#3F4B45')
          .lineHeight(19)
          .maxLines(this.compact ? 2 : 4)
          .width('100%')
      }

      Row({ space: 7 }) {
        ForEach(this.restaurant.tags.slice(0, 3), (tag: string) => {
          Text(tag)
            .fontSize(11)
            .fontColor('#47705F')
            .padding({ left: 8, right: 8, top: 4, bottom: 4 })
            .borderRadius(10)
            .backgroundColor('#EFF7F2')
        })
      }
      .width('100%')

      Row({ space: 10 }) {
        Button('查看详情')
          .type(ButtonType.Normal)
          .fontSize(13)
          .fontColor('#16785A')
          .backgroundColor('#EDF6F1')
          .borderRadius(16)
          .height(34)
          .layoutWeight(1)
          .onClick(() => this.onDetail(this.restaurant))
        if (this.showSelect) {
          Button('选择这家')
            .type(ButtonType.Normal)
            .fontSize(13)
            .fontColor(Color.White)
            .backgroundColor('#16785A')
            .borderRadius(16)
            .height(34)
            .layoutWeight(1)
            .onClick(() => this.onSelect(this.restaurant))
        }
      }
      .width('100%')
    }
    .width('100%')
    .padding(14)
    .borderRadius(20)
    .backgroundColor(Color.White)
    .shadow({ radius: 10, color: '#140B5A3C', offsetX: 0, offsetY: 3 })
  }
}
