import { abilityAccessCtrl, Context, Permissions } from '@kit.AbilityKit';
import { geoLocationManager } from '@kit.LocationKit';
import { UserLocation } from '../model/Models';

export class LocationService {
  static async current(context: Context): Promise<UserLocation | undefined> {
    try {
      const permissions: Permissions[] = [
        'ohos.permission.APPROXIMATELY_LOCATION',
        'ohos.permission.LOCATION'
      ];
      const result = await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(context, permissions);
      if (!result.authResults.some((value: number) => value === 0)) {
        return undefined;
      }
      const location = await geoLocationManager.getCurrentLocation();
      if (!Number.isFinite(location.longitude) || !Number.isFinite(location.latitude)) {
        return undefined;
      }
      return { longitude: location.longitude, latitude: location.latitude } as UserLocation;
    } catch (_error) {
      return undefined;
    }
  }
}
