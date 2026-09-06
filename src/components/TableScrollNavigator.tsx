import { useCallback, useEffect, useRef, useState } from 'react';

type NavigatorState = {
  canScrollLeft: boolean;
  canScrollRight: boolean;
  page: number;
  pageCount: number;
};

const findHorizontalScroller = (table: HTMLTableElement, root: HTMLElement) => {
  let element = table.parentElement;
  while (element && element !== root) {
    const overflowX = window.getComputedStyle(element).overflowX;
    if ((overflowX === 'auto' || overflowX === 'scroll') && element.scrollWidth > element.clientWidth + 4) {
      return element;
    }
    element = element.parentElement;
  }
  return null;
};

export const TableScrollNavigator = () => {
  const targetRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const [state, setState] = useState<NavigatorState | null>(null);

  const update = useCallback(() => {
    const root = document.querySelector<HTMLElement>('.app-main');
    if (!root) {
      targetRef.current = null;
      setState(null);
      return;
    }

    const candidates = new Map<HTMLElement, number>();
    root.querySelectorAll<HTMLTableElement>('table').forEach((table) => {
      const scroller = findHorizontalScroller(table, root);
      if (!scroller) return;

      const rect = scroller.getBoundingClientRect();
      const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
      if (visibleHeight < 56 || rect.right < 0 || rect.left > window.innerWidth) return;

      const distanceFromCenter = Math.abs((rect.top + rect.bottom) / 2 - window.innerHeight / 2);
      candidates.set(scroller, visibleHeight * 10 - distanceFromCenter);
    });

    const target = Array.from(candidates.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    targetRef.current = target;
    if (!target) {
      setState(null);
      return;
    }

    const maxScroll = Math.max(0, target.scrollWidth - target.clientWidth);
    const pageCount = Math.max(1, Math.ceil(target.scrollWidth / Math.max(target.clientWidth, 1)));
    const page = pageCount === 1 || maxScroll === 0
      ? 1
      : Math.min(pageCount, Math.max(1, Math.round((target.scrollLeft / maxScroll) * (pageCount - 1)) + 1));
    const nextState = {
      canScrollLeft: target.scrollLeft > 2,
      canScrollRight: target.scrollLeft < maxScroll - 2,
      page,
      pageCount,
    };
    setState((current) => current
      && current.canScrollLeft === nextState.canScrollLeft
      && current.canScrollRight === nextState.canScrollRight
      && current.page === nextState.page
      && current.pageCount === nextState.pageCount
      ? current
      : nextState);
  }, []);

  const scheduleUpdate = useCallback(() => {
    if (frameRef.current != null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      update();
    });
  }, [update]);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.app-main');
    const observer = root ? new MutationObserver(scheduleUpdate) : null;
    observer?.observe(root!, { childList: true, subtree: true });
    window.addEventListener('resize', scheduleUpdate);
    document.addEventListener('scroll', scheduleUpdate, true);
    scheduleUpdate();

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', scheduleUpdate);
      document.removeEventListener('scroll', scheduleUpdate, true);
      if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
    };
  }, [scheduleUpdate]);

  const move = (direction: -1 | 1) => {
    const target = targetRef.current;
    if (!target) return;
    target.scrollBy({ left: direction * Math.max(320, target.clientWidth * 0.72), behavior: 'smooth' });
  };

  if (!state) return null;

  return (
    <nav className="table-scroll-navigator" aria-label="เลื่อนดูคอลัมน์ตาราง">
      <button type="button" onClick={() => move(-1)} disabled={!state.canScrollLeft} aria-label="เลื่อนตารางไปทางซ้าย">‹</button>
      <span>↔ คอลัมน์ {state.page}/{state.pageCount}</span>
      <button type="button" onClick={() => move(1)} disabled={!state.canScrollRight} aria-label="เลื่อนตารางไปทางขวา">›</button>
    </nav>
  );
};
