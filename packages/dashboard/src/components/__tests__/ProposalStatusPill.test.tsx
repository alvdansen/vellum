/**
 * ProposalStatusPill — renders the lifecycle state text + data-status hook.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/preact';
import { ProposalStatusPill } from '../ProposalStatusPill.js';

describe('ProposalStatusPill', () => {
  it.each(['proposed', 'approved', 'rejected'] as const)(
    'renders %s with a matching data-status',
    (status) => {
      const { getByTestId } = render(<ProposalStatusPill status={status} />);
      const pill = getByTestId('proposal-status-pill');
      expect(pill).toHaveAttribute('data-status', status);
      expect(pill.textContent).toBe(status);
    },
  );
});
