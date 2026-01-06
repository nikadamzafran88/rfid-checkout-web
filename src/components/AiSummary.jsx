import React, { useEffect, useMemo, useState } from 'react';
import { Box, Button, ButtonGroup, CircularProgress, Alert, Typography } from '@mui/material';
import firebaseConfig, { auth } from '../firebaseConfig';

const AiSummary = ({
  sales,
  disabled,
  role,
  scope = 'default',
  title = 'AI Executive Summary',
  idleSubtitle,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');
  const [structured, setStructured] = useState(null);
  const [generatedAt, setGeneratedAt] = useState(0);
  const [audience, setAudience] = useState('owner');

  const userRole = String(role || '').toLowerCase();
  const allowedAudiences = useMemo(() => {
    if (userRole === 'admin') return ['owner', 'staff', 'finance'];
    if (userRole === 'manager') return ['owner', 'staff'];
    if (userRole === 'staff') return ['staff'];
    return [];
  }, [userRole]);

  const canGenerate = allowedAudiences.length > 0 && !disabled && sales && typeof sales === 'object';

  // Ensure selected audience is permitted for this role.
  useEffect(() => {
    if (!allowedAudiences.length) return;
    if (!allowedAudiences.includes(audience)) setAudience(allowedAudiences[0]);
  }, [allowedAudiences, audience]);

  const generate = async ({ noCache = false } = {}) => {
    if (!canGenerate || loading) return;
    setLoading(true);
    setError('');

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not signed in.');
      const token = await user.getIdToken();

      const projectId = firebaseConfig?.projectId || 'rfid-self-checkout-system';
      const url = `https://asia-southeast1-${projectId}.cloudfunctions.net/generateAiExecutiveSummaryHttp`;

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ sales, currency: 'RM', scope, audience, noCache }),
      });

      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || json?.success === false) {
        const base = json?.error || json?.message || `Request failed (${resp.status}).`;
        const details = json?.details && typeof json.details === 'object' ? json.details : null;
        const extra = details
          ? [
              details.status ? `status=${details.status}` : null,
              details.model ? `model=${details.model}` : null,
              details.apiVersion ? `api=${details.apiVersion}` : null,
              details.message ? `msg=${String(details.message).slice(0, 200)}` : null,
            ].filter(Boolean).join(' • ')
          : '';
        const msg = extra ? `${base} (${extra})` : base;
        throw new Error(msg);
      }

      const text = json?.summary ? String(json.summary) : '';
      const structuredObj = json?.structured && typeof json.structured === 'object' ? json.structured : null;
      const trimmed = text.trim();
      if (!trimmed && !structuredObj) {
        throw new Error('AI returned an empty response. Please try Regenerate.');
      }

      setSummary(trimmed);
      setStructured(structuredObj);
      setGeneratedAt(Date.now());
    } catch (e) {
      console.error('generateAiExecutiveSummary failed', e);
      setError(e?.message || 'Failed to generate summary.');
    } finally {
      setLoading(false);
    }
  };

  const subtitle = useMemo(() => {
    if (!userRole) return 'Checking access…';
    if (!allowedAudiences.length) return 'No access for this role.';
    if (disabled) return 'Loading data…';
    if (generatedAt) return `Updated ${new Date(generatedAt).toLocaleString()}`;
    return idleSubtitle || 'Generate insights (what changed, why, what to do).';
  }, [allowedAudiences.length, disabled, generatedAt, userRole]);

  const renderStructured = Boolean(structured && typeof structured === 'object');
  const actions = Array.isArray(structured?.whatToDoNext) ? structured.whatToDoNext.filter(Boolean) : [];

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, mb: 0.5 }}>
        <Box>
          <Typography
            component="div"
            variant="caption"
            sx={{ fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase' }}
            color="text.secondary"
          >
            {title}
          </Typography>
          <Typography component="div" variant="caption" color="text.secondary">{subtitle}</Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          {allowedAudiences.length > 1 ? (
            <ButtonGroup size="small" variant="outlined" disabled={!canGenerate || loading}>
              {allowedAudiences.includes('owner') ? (
                <Button
                  onClick={() => setAudience('owner')}
                  variant={audience === 'owner' ? 'contained' : 'outlined'}
                  sx={{ px: 1.0, py: 0.5, minWidth: 0, whiteSpace: 'nowrap' }}
                >
                  Owner
                </Button>
              ) : null}
              {allowedAudiences.includes('staff') ? (
                <Button
                  onClick={() => setAudience('staff')}
                  variant={audience === 'staff' ? 'contained' : 'outlined'}
                  sx={{ px: 1.0, py: 0.5, minWidth: 0, whiteSpace: 'nowrap' }}
                >
                  Staff
                </Button>
              ) : null}
              {allowedAudiences.includes('finance') ? (
                <Button
                  onClick={() => setAudience('finance')}
                  variant={audience === 'finance' ? 'contained' : 'outlined'}
                  sx={{ px: 1.0, py: 0.5, minWidth: 0, whiteSpace: 'nowrap' }}
                >
                  Finance
                </Button>
              ) : null}
            </ButtonGroup>
          ) : null}

          <Button
            size="small"
            variant="outlined"
            onClick={() => generate({ noCache: Boolean(summary || structured) })}
            disabled={!canGenerate || loading}
            sx={{ whiteSpace: 'nowrap', minWidth: 0, px: 1.25, py: 0.5 }}
          >
            {loading ? <CircularProgress size={16} /> : (summary || structured ? 'Regenerate' : 'Generate')}
          </Button>
        </Box>
      </Box>

      {error ? (
        <Alert severity="error" sx={{ mt: 0.75 }}>
          {error}
        </Alert>
      ) : null}

      {renderStructured ? (
        <Box sx={{ mt: 0.75 }}>
          {structured?.headline ? (
            <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.35 }}>
              {String(structured.headline)}
            </Typography>
          ) : null}

          {structured?.whatChanged ? (
            <Typography variant="body2" sx={{ mt: 0.5, lineHeight: 1.35 }}>
              <Box component="span" sx={{ fontWeight: 800 }}>What changed:</Box>{' '}
              {String(structured.whatChanged)}
            </Typography>
          ) : null}

          {structured?.whyLikely ? (
            <Typography variant="body2" sx={{ mt: 0.5, lineHeight: 1.35 }}>
              <Box component="span" sx={{ fontWeight: 800 }}>Why likely:</Box>{' '}
              {String(structured.whyLikely)}
            </Typography>
          ) : null}

          {actions.length ? (
            <Box sx={{ mt: 0.75 }}>
              <Typography variant="body2" sx={{ fontWeight: 800, mb: 0.25 }}>
                What to do next:
              </Typography>
              {actions.map((a, idx) => (
                <Typography key={idx} variant="body2" sx={{ lineHeight: 1.35 }}>
                  {idx + 1}. {String(a)}
                </Typography>
              ))}
            </Box>
          ) : null}

          {structured?.riskFlag && structured.riskFlag !== 'none' ? (
            <Typography variant="caption" sx={{ display: 'block', mt: 0.75 }} color="text.secondary">
              Risk flag: {String(structured.riskFlag)}
            </Typography>
          ) : null}
        </Box>
      ) : summary ? (
        <Typography variant="body2" sx={{ mt: 0.75, lineHeight: 1.35 }}>
          {summary}
        </Typography>
      ) : (
        <Typography variant="body2" sx={{ mt: 0.75, color: 'text.secondary' }}>
          {allowedAudiences.length ? 'Click Generate to get today’s performance.' : 'You do not have permission to generate this summary.'}
        </Typography>
      )}
    </Box>
  );
};

export default AiSummary;
