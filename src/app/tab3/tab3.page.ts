import { Component } from '@angular/core';
import { IonContent, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  shieldCheckmarkOutline,
  lockClosedOutline,
  documentTextOutline,
  personOutline,
  calendarOutline,
  globeOutline,
  analyticsOutline,
  languageOutline,
} from 'ionicons/icons';

@Component({
  selector: 'app-tab3',
  templateUrl: 'tab3.page.html',
  styleUrls: ['tab3.page.scss'],
  imports: [IonContent, IonIcon],
})
export class Tab3Page {
  constructor() {
    addIcons({
      shieldCheckmarkOutline,
      lockClosedOutline,
      documentTextOutline,
      personOutline,
      calendarOutline,
      globeOutline,
      analyticsOutline,
      languageOutline,
    });
  }
}
