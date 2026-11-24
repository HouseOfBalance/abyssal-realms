const COMBO_WINDOW_SEC = 5.0;
const MAX_COMBO_MULTIPLIER = 2.5;
const MULTIPLIER_PER_KILL = 0.05;

export class ComboTracker {
  private count = 0;
  private timerSec = 0;

  registerKill(bonusWeight = 1): void {
    const increment = Math.max(1, Math.floor(bonusWeight));
    this.count += increment;
    this.timerSec = COMBO_WINDOW_SEC;
  }

  update(dt: number): void {
    if (dt <= 0 || this.count <= 0) return;
    this.timerSec -= dt;
    if (this.timerSec <= 0) {
      this.reset();
    }
  }

  getState(): { count: number; timerSec: number; multiplier: number } {
    if (this.count <= 0 || this.timerSec <= 0) {
      return { count: 0, timerSec: 0, multiplier: 1 };
    }
    const rawBonus = Math.min(MAX_COMBO_MULTIPLIER - 1, this.count * MULTIPLIER_PER_KILL);
    const multiplier = Math.round((1 + rawBonus) * 100) / 100;
    return {
      count: this.count,
      timerSec: Math.max(0, Math.round(this.timerSec * 1000) / 1000),
      multiplier,
    };
  }

  reset(): void {
    this.count = 0;
    this.timerSec = 0;
  }
}
