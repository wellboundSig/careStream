import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, ...props }) => <a href={to} {...props}>{children}</a>,
  useLocation: () => ({ pathname: '/' }),
}));

const { default: SubNav, ALL_PINNABLE } = await import('../SubNav.jsx');

describe('SubNav', () => {
  it('renders nothing when pinnedPages is empty', () => {
    const { container } = render(<SubNav pinnedPages={[]} onReorder={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders pinned page labels', () => {
    render(<SubNav pinnedPages={['/', '/pipeline', '/tasks']} onReorder={vi.fn()} />);
    expect(screen.getByText('Dashboard')).toBeTruthy();
    expect(screen.getByText('Pipeline')).toBeTruthy();
    expect(screen.getByText('Tasks')).toBeTruthy();
  });

  it('renders all pinned links with draggable attribute', () => {
    render(<SubNav pinnedPages={['/', '/pipeline']} onReorder={vi.fn()} />);
    const links = screen.getAllByRole('link');
    links.forEach((link) => {
      expect(link.getAttribute('draggable')).toBeTruthy();
    });
  });

  it('calls onReorder with new order on drag and drop', () => {
    const onReorder = vi.fn();
    render(<SubNav pinnedPages={['/', '/pipeline', '/tasks']} onReorder={onReorder} />);
    const links = screen.getAllByRole('link');
    
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() };
    fireEvent.dragStart(links[0], { dataTransfer });
    fireEvent.dragOver(links[2], { dataTransfer, preventDefault: vi.fn() });
    fireEvent.drop(links[2], { dataTransfer, preventDefault: vi.fn() });
    
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(['/pipeline', '/tasks', '/']);
  });

  it('highlights the active page', () => {
    render(<SubNav pinnedPages={['/', '/pipeline']} onReorder={vi.fn()} />);
    const dashLink = screen.getByText('Dashboard');
    expect(dashLink.style.borderBottom).toContain('solid');
  });
});

describe('ALL_PINNABLE', () => {
  it('includes "Leads" label for lead-entry path', () => {
    const leadEntry = ALL_PINNABLE.find((p) => p.path === '/modules/lead-entry');
    expect(leadEntry.label).toBe('Leads');
  });

  it('includes "Completed" label for soc-completed path', () => {
    const completed = ALL_PINNABLE.find((p) => p.path === '/modules/soc-completed');
    expect(completed.label).toBe('Completed');
  });
});
