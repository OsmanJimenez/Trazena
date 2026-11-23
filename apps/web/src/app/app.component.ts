import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TuiRoot } from '@taiga-ui/core';
import { ThemeService } from './core/state/theme.service';
import { TrazenaUpdateService } from './core/update/trazena-update.service';

@Component({
  selector: 'trz-root',
  standalone: true,
  imports: [RouterOutlet, TuiRoot],
  template: `
    <tui-root>
      <router-outlet />
    </tui-root>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnInit {
  private readonly theme = inject(ThemeService);
  private readonly updater = inject(TrazenaUpdateService);

  ngOnInit(): void {
    void this.theme.initialize();
    this.updater.initialize();
  }
}
