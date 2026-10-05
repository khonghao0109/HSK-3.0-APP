import { describe, expect, it } from 'vitest';

import { routeForOnboarding } from './route-for-onboarding';

describe('routeForOnboarding', () => {
  it('returns /onboarding/goal when nextStep is set_goal', () => {
    expect(routeForOnboarding({ nextStep: 'set_goal' })).toBe(
      '/onboarding/goal',
    );
  });

  it('returns /onboarding/goal?notice=content_unavailable when nextStep is content_unavailable', () => {
    expect(routeForOnboarding({ nextStep: 'content_unavailable' })).toBe(
      '/onboarding/goal?notice=content_unavailable',
    );
  });

  describe('nextStep is generate_plan', () => {
    it('returns /onboarding/plan with purpose and band when goal has learningPurpose and targetBand', () => {
      expect(
        routeForOnboarding(
          { nextStep: 'generate_plan' },
          { learningPurpose: 'communication', targetBand: 3 },
        ),
      ).toBe('/onboarding/plan?purpose=communication&band=3');

      expect(
        routeForOnboarding(
          { nextStep: 'generate_plan' },
          { learningPurpose: 'hsk_exam', targetBand: 8 },
        ),
      ).toBe('/onboarding/plan?purpose=hsk_exam&band=8');
    });

    it('returns /onboarding/goal?band=<targetBand> when goal has no learningPurpose', () => {
      expect(
        routeForOnboarding(
          { nextStep: 'generate_plan' },
          { learningPurpose: null, targetBand: 3 },
        ),
      ).toBe('/onboarding/goal?band=3');

      expect(
        routeForOnboarding(
          { nextStep: 'generate_plan' },
          { learningPurpose: null, targetBand: 2 },
        ),
      ).toBe('/onboarding/goal?band=2');
    });

    it('falls back to /onboarding/goal when goal is null or missing band', () => {
      expect(routeForOnboarding({ nextStep: 'generate_plan' }, null)).toBe(
        '/onboarding/goal',
      );
    });
  });

  it('returns null when nextStep is ready to keep current /learn page', () => {
    expect(routeForOnboarding({ nextStep: 'ready' })).toBeNull();
  });
});
