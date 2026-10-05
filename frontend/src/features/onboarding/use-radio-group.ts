import { useCallback } from 'react';

export function useRadioGroup<T>({
  items,
  onChange,
}: {
  items: readonly T[];
  onChange: (val: T) => void;
}) {
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
      let targetIndex = -1;

      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        targetIndex = (currentIndex + 1) % items.length;
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        targetIndex = (currentIndex - 1 + items.length) % items.length;
      }

      if (targetIndex >= 0 && targetIndex < items.length) {
        const nextValue = items[targetIndex];
        if (nextValue !== undefined) {
          onChange(nextValue);

          const container = event.currentTarget.closest('[role="radiogroup"]');
          if (container) {
            const buttons = container.querySelectorAll<HTMLButtonElement>(
              'button[role="radio"]',
            );
            buttons[targetIndex]?.focus();
          }
        }
      }
    },
    [items, onChange],
  );

  return {
    handleKeyDown,
  };
}
