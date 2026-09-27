import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.opentweek',
  appName: 'opentweek',
  webDir: 'dist',
  android: {
    backgroundColor: '#ffffff',
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_opentweek',
      iconColor: '#2f6cf6',
    },
  },
}

export default config
