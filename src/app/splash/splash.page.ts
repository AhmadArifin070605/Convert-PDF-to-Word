import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-splash',
  templateUrl: './splash.page.html',
  styleUrls: ['./splash.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule],
})
export class SplashPage implements OnInit, OnDestroy {
  private splashTimeoutId?: ReturnType<typeof setTimeout>;

  constructor(private router: Router) { }

  ngOnInit(): void {
    this.splashTimeoutId = setTimeout(() => {
      void this.router.navigateByUrl('/tabs/tab1', { replaceUrl: true });
    }, 2500);
  }

  ngOnDestroy(): void {
    if (this.splashTimeoutId) {
      clearTimeout(this.splashTimeoutId);
    }
  }
}
