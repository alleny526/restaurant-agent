import { abilityAccessCtrl, Context, PermissionRequestResult, Permissions } from '@kit.AbilityKit';
import { geoLocationManager } from '@kit.LocationKit';
import { UserLocation } from '../model/Models';

const LOCATION_PERMISSIONS: Permissions[] = [
  'ohos.permission.APPROXIMATELY_LOCATION',
  'ohos.permission.LOCATION'
];

export class LocationService {
  static async current(context: Context): Promise<UserLocation | undefined> {
    try {
      const permissionResult: PermissionRequestResult = await abilityAccessCtrl.createAtManager()
        .requestPermissionsFromUser(context, LOCATION_PERMISSIONS);
      const authorized: boolean = permissionResult.authResults.some((result: number) => result === 0);
      if (!authorized) return undefined;

      const location: geoLocationManager.Location = await geoLocationManager.getCurrentLocation({
        priority: geoLocationManager.LocationRequestPriority.FIRST_FIX,
        timeoutMs: 10000
      });
      return {
        longitude: location.longitude,
        latitude: location.latitude
      } as UserLocation;
    } catch (_error) {
      // Location is an optional enhancement. Restaurant loading can continue without it.
      return undefined;
    }
  }
}
