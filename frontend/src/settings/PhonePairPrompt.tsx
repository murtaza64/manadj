import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import './PhonePairPrompt.css';

/** App-wide approve prompt for zero-typing phone pairing (#374). Silent
 * unless Phone sync is on and a phone on the network asked to pair. The
 * user checks that the 4-digit code matches the phone's before approving. */
export function PhonePairPrompt() {
  const client = useQueryClient();
  const status = useQuery({
    queryKey: ['device-listener'],
    queryFn: api.deviceListener.get,
    refetchInterval: 15_000,
  });
  const enabled = status.data?.enabled === true;
  const requests = useQuery({
    queryKey: ['device-listener', 'pair-requests'],
    queryFn: api.deviceListener.pairRequests,
    enabled,
    refetchInterval: 2_000,
  });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'deny' }) =>
      api.deviceListener.decide(id, decision),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['device-listener'] });
    },
  });

  const request = enabled ? requests.data?.[0] : undefined;
  if (!request) return null;
  return (
    <div className="phone-pair-prompt" role="alertdialog" aria-label="Phone pairing request">
      <span className="phone-pair-title">Pair “{request.device_name}”?</span>
      <p>
        A phone at {request.client} wants to sync your Library. Approve only if
        it shows this code:
      </p>
      <code className="phone-pair-code">{request.match_code}</code>
      <div className="phone-pair-actions">
        <button
          className="btn btn-secondary"
          disabled={decide.isPending}
          onClick={() => decide.mutate({ id: request.id, decision: 'deny' })}
        >
          Deny
        </button>
        <button
          className="btn btn-primary"
          disabled={decide.isPending}
          onClick={() => decide.mutate({ id: request.id, decision: 'approve' })}
        >
          Approve
        </button>
      </div>
    </div>
  );
}
