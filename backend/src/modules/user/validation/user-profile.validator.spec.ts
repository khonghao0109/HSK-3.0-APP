import {
  IsValidDisplayNameConstraint,
  IsValidLocaleConstraint,
  IsValidTimezoneConstraint,
  SUPPORTED_LOCALES,
  validateDisplayName,
  validateLocale,
  validateTimezone,
} from './user-profile.validator';

describe('UserProfile Validator', () => {
  describe('validateDisplayName', () => {
    it('accepts null to clear display name', () => {
      expect(validateDisplayName(null)).toEqual({
        valid: true,
        normalized: null,
      });
    });

    it('trims leading and trailing whitespace', () => {
      expect(validateDisplayName('  Nguyễn Văn A  ')).toEqual({
        valid: true,
        normalized: 'Nguyễn Văn A',
      });
    });

    it('allows 50 Vietnamese characters with diacritics', () => {
      // 50 characters of Vietnamese text with diacritics
      const fiftyChars = 'Nguyễn Thị Ánh Tuyết Hoàng Phúc Quỳnh Mai Đặng Văn';
      expect(Array.from(fiftyChars).length).toBe(50);
      expect(validateDisplayName(fiftyChars)).toEqual({
        valid: true,
        normalized: fiftyChars,
      });
    });

    it('allows Chinese characters', () => {
      expect(validateDisplayName('张三李四')).toEqual({
        valid: true,
        normalized: '张三李四',
      });
    });

    it('rejects empty string', () => {
      expect(validateDisplayName('')).toEqual({
        valid: false,
        error: 'displayName must not be empty after trimming.',
      });
    });

    it('rejects whitespace-only string', () => {
      expect(validateDisplayName('    ')).toEqual({
        valid: false,
        error: 'displayName must not be empty after trimming.',
      });
    });

    it('rejects display name exceeding 50 Unicode code points', () => {
      const fiftyOneChars = 'a'.repeat(51);
      expect(Array.from(fiftyOneChars).length).toBe(51);
      expect(validateDisplayName(fiftyOneChars)).toEqual({
        valid: false,
        error: 'displayName must not exceed 50 characters.',
      });
    });

    it('rejects U+202E (Right-to-Left Override) bidi character', () => {
      const withBidi = 'User\u202EName';
      expect(validateDisplayName(withBidi)).toEqual({
        valid: false,
        error: 'displayName must not contain bidi override characters.',
      });
    });

    it.each([
      ['\u202A', 'LRE'],
      ['\u202B', 'RLE'],
      ['\u202C', 'PDF'],
      ['\u202D', 'LRO'],
      ['\u202E', 'RLO'],
      ['\u2066', 'LRI'],
      ['\u2067', 'RLI'],
      ['\u2068', 'FSI'],
      ['\u2069', 'PDI'],
    ])('rejects bidi override character %s (%s)', (char) => {
      expect(validateDisplayName(`prefix${char}suffix`)).toEqual({
        valid: false,
        error: 'displayName must not contain bidi override characters.',
      });
    });

    it.each([
      ['newline', 'line1\nline2'],
      ['tab', 'col1\tcol2'],
      ['null byte', 'text\0text'],
      ['escape', 'text\x1Btext'],
      ['delete', 'text\x7Ftext'],
      ['C1 control', 'text\x85text'],
    ])('rejects control characters (%s)', (_, val) => {
      expect(validateDisplayName(val)).toEqual({
        valid: false,
        error: 'displayName must not contain control characters.',
      });
    });

    it.each([123, true, {}, []])(
      'rejects non-string non-null values (%j)',
      (val) => {
        expect(validateDisplayName(val)).toEqual({
          valid: false,
          error: 'displayName must be a string or null.',
        });
      },
    );
  });

  describe('validateLocale', () => {
    it('accepts vi-VN', () => {
      expect(validateLocale('vi-VN')).toEqual({
        valid: true,
        normalized: 'vi-VN',
      });
    });

    it.each(['en-US', 'zh-CN', 'fr-FR', '', 'vi_VN'])(
      'rejects unsupported locale (%s)',
      (loc) => {
        expect(validateLocale(loc)).toEqual({
          valid: false,
          error: `locale must be one of: ${SUPPORTED_LOCALES.join(', ')}.`,
        });
      },
    );

    it.each([null, undefined, 123, true])(
      'rejects non-string locale (%j)',
      (val) => {
        expect(validateLocale(val)).toEqual({
          valid: false,
          error: 'locale must be a string.',
        });
      },
    );
  });

  describe('validateTimezone', () => {
    it.each([
      ['Asia/Ho_Chi_Minh'],
      ['UTC'],
      ['Etc/GMT+7'],
      ['America/Argentina/Buenos_Aires'],
      ['America/Port-au-Prince'],
    ])('accepts valid IANA timezone %s and preserves it verbatim', (tz) => {
      const res = validateTimezone(tz);
      expect(res).toEqual({
        valid: true,
        normalized: tz,
      });
    });

    it.each([['asia/ho_chi_minh'], ['+07:00'], ['EST5EDT']])(
      'rejects non-matching IANA format timezone %s',
      (tz) => {
        expect(validateTimezone(tz)).toEqual({
          valid: false,
          error: 'timezone must match the standard IANA timezone format.',
        });
      },
    );

    it('rejects invalid timezone Mars/Base', () => {
      expect(validateTimezone('Mars/Base')).toEqual({
        valid: false,
        error: 'timezone must be a valid IANA timezone identifier.',
      });
    });

    it('rejects timezone string exceeding 64 characters', () => {
      const longTimezone = 'A'.repeat(65);
      expect(validateTimezone(longTimezone)).toEqual({
        valid: false,
        error: 'timezone length must be between 1 and 64 characters.',
      });
    });

    it('rejects empty string timezone', () => {
      expect(validateTimezone('')).toEqual({
        valid: false,
        error: 'timezone length must be between 1 and 64 characters.',
      });
    });

    it.each([null, undefined, 123, true])(
      'rejects non-string timezone (%j)',
      (val) => {
        expect(validateTimezone(val)).toEqual({
          valid: false,
          error: 'timezone must be a string.',
        });
      },
    );
  });

  describe('Validator Constraints', () => {
    const displayNameConstraint = new IsValidDisplayNameConstraint();
    const localeConstraint = new IsValidLocaleConstraint();
    const timezoneConstraint = new IsValidTimezoneConstraint();

    it('IsValidDisplayNameConstraint validates correctly', () => {
      expect(displayNameConstraint.validate('Valid Name')).toBe(true);
      expect(displayNameConstraint.validate(null)).toBe(true);
      expect(displayNameConstraint.validate('a\u202Eb')).toBe(false);
      expect(displayNameConstraint.defaultMessage()).toContain('displayName');
    });

    it('IsValidLocaleConstraint validates correctly', () => {
      expect(localeConstraint.validate('vi-VN')).toBe(true);
      expect(localeConstraint.validate('en-US')).toBe(false);
      expect(localeConstraint.defaultMessage()).toContain('locale');
    });

    it('IsValidTimezoneConstraint validates correctly', () => {
      expect(timezoneConstraint.validate('Asia/Ho_Chi_Minh')).toBe(true);
      expect(timezoneConstraint.validate('Mars/Base')).toBe(false);
      expect(timezoneConstraint.defaultMessage()).toContain('timezone');
    });
  });
});
