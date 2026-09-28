import { AfterViewInit, Component, OnDestroy, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Platform } from '@ionic/angular';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import type { Subscription } from 'rxjs';
import { HistoryService } from './services/history';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent implements AfterViewInit, OnDestroy {
  @ViewChild(IonRouterOutlet) private routerOutlet?: IonRouterOutlet;

  private backButtonSubscription?: Subscription;

  constructor(
    private platform: Platform,
    private router: Router,
    private historyService: HistoryService,
  ) {
    void this.historyService.migrateLegacyEntries();
  }

  ngAfterViewInit(): void {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    void this.applyNativeSystemBarStyle();

    this.backButtonSubscription = this.platform.backButton.subscribeWithPriority(9999, () => {
      void this.handleBackButton();
    });
  }

  ngOnDestroy(): void {
    this.backButtonSubscription?.unsubscribe();
  }

  private async handleBackButton(): Promise<void> {
    if (this.routerOutlet?.canGoBack()) {
      await this.routerOutlet.pop();
      return;
    }

    if (!this.isExitRoute(this.router.url)) {
      return;
    }

    await CapacitorApp.exitApp();
  }

  private isExitRoute(url: string): boolean {
    const currentUrl = url.split('?')[0].split('#')[0];
    return currentUrl === '/splash' || currentUrl === '/tabs' || currentUrl.startsWith('/tabs/tab');
  }

  private async applyNativeSystemBarStyle(): Promise<void> {
    try {
      await StatusBar.setStyle({ style: Style.Light });
      await StatusBar.setBackgroundColor({ color: '#00000000' });
      await StatusBar.setOverlaysWebView({ overlay: true });
    } catch (error) {
      console.warn('Failed to apply status bar style:', error);
    }
  }
}
