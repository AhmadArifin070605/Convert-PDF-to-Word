import { Component, EnvironmentInjector, inject } from '@angular/core';
// 1. Tambahkan IonRouterOutlet di sini
import { IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel, IonRouterOutlet } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
// 2. Sesuaikan ikon dengan yang Anda gunakan di HTML
import { homeOutline, timeOutline, shieldCheckmarkOutline } from 'ionicons/icons';

@Component({
  selector: 'app-tabs',
  templateUrl: 'tabs.page.html',
  styleUrls: ['tabs.page.scss'],
  standalone: true, // Pastikan ini tetap ada
  // 3. Masukkan IonRouterOutlet ke dalam array imports
  imports: [IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel, IonRouterOutlet],
})
export class TabsPage {
  public environmentInjector = inject(EnvironmentInjector);

  constructor() {
    // 4. Daftarkan ikon yang akan dipakai
    addIcons({ homeOutline, timeOutline, shieldCheckmarkOutline });
  }
}