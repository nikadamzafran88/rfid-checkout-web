import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  Divider,
  CircularProgress,
  Alert,
  Stack,
} from '@mui/material';
import { collection, addDoc, getDocs, query, where, updateDoc, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/ui/PageHeader';
import SectionCard from '../components/ui/SectionCard';

const LeaveManagement = () => {
  const { currentUser, currentRole } = useAuth();

  const [type, setType] = useState('medical');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [requests, setRequests] = useState([]);

  const leaveCol = collection(db, 'leave_requests');

  const loadRequests = async () => {
    setLoading(true);
    setMessage('');
    try {
      if (currentRole === 'admin' || currentRole === 'manager') {
        // Managers and admins see all requests
        const snap = await getDocs(leaveCol);
        let list = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Resolve user names for display
        const uids = Array.from(new Set(list.map((r) => r.userUID).filter(Boolean)));
        const nameMap = {};
        await Promise.all(uids.map(async (uid) => {
          try {
            const userSnap = await getDoc(doc(db, 'users', uid));
            if (userSnap.exists()) {
              const data = userSnap.data() || {};
              nameMap[uid] = data.fullName || data.displayName || data.name || data.email || uid;
            } else {
              nameMap[uid] = uid;
            }
          } catch (err) {
            console.error('Failed to fetch user for leave display:', err);
            nameMap[uid] = uid;
          }
        }));

        list = list.map((r) => ({ ...r, displayName: nameMap[r.userUID] || r.userUID }));
        setRequests(list);
      } else if (currentUser) {
        // Staff see their own requests
        const q = query(leaveCol, where('userUID', '==', currentUser.uid));
        const snap = await getDocs(q);
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // currentUser displayName
        const meName = currentUser.displayName || currentUser.fullName || currentUser.email || currentUser.uid;
        setRequests(list.map(r => ({ ...r, displayName: meName })));
      } else {
        setRequests([]);
      }
    } catch (err) {
      console.error('Failed to load leave requests:', err);
      setMessage('Failed to load leave requests.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, currentRole]);

  const handleSubmit = async () => {
    if (!currentUser) {
      setMessage('Sign in to submit leave requests.');
      return;
    }
    if (!startDate || !endDate) {
      setMessage('Select start and end dates.');
      return;
    }

    setSubmitting(true);
    setMessage('');
    try {
      const requesterDisplayName = currentUser.displayName || currentUser.fullName || currentUser.email || currentUser.uid;
      await addDoc(leaveCol, {
        userUID: currentUser.uid,
        requesterDisplayName,
        type,
        startDate,
        endDate,
        reason,
        status: 'Pending',
        submittedAt: new Date().toISOString(),
      });
      setMessage('Leave request submitted.');
      setType('medical');
      setStartDate('');
      setEndDate('');
      setReason('');
      await loadRequests();
    } catch (err) {
      console.error('Failed to submit leave request:', err);
      setMessage('Failed to submit leave request.');
    } finally {
      setSubmitting(false);
    }
  };

  const updateStatus = async (id, newStatus) => {
    setLoading(true);
    try {
      const ref = doc(db, 'leave_requests', id);
      const reviewerName = currentUser?.displayName || currentUser?.fullName || currentUser?.email || currentUser?.uid || null;
      await updateDoc(ref, {
        status: newStatus,
        reviewedBy: currentUser?.uid || null,
        reviewerName,
        reviewedAt: new Date().toISOString(),
      });
      await loadRequests();
    } catch (err) {
      console.error('Failed to update status:', err);
      setMessage('Failed to update status.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader title="Leave Requests" subtitle="Submit leave requests and manage approvals." />

      {message && <Alert severity="info" sx={{ mb: 2 }}>{message}</Alert>}

      <SectionCard title="Apply for Leave" sx={{ mb: 3 }}>
        <Stack spacing={2}>
          <FormControl size="small">
            <InputLabel id="type-label">Type</InputLabel>
            <Select labelId="type-label" value={type} label="Type" onChange={(e) => setType(e.target.value)}>
              <MenuItem value="medical">Medical</MenuItem>
              <MenuItem value="personal">Personal</MenuItem>
              <MenuItem value="emergency">Emergency</MenuItem>
            </Select>
          </FormControl>

          <TextField label="Start Date" type="date" size="small" InputLabelProps={{ shrink: true }} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <TextField label="End Date" type="date" size="small" InputLabelProps={{ shrink: true }} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          <TextField label="Reason" multiline minRows={3} value={reason} onChange={(e) => setReason(e.target.value)} />

          <Box>
            <Button variant="contained" onClick={handleSubmit} disabled={submitting}>{submitting ? <CircularProgress size={18} /> : 'Submit Request'}</Button>
          </Box>
        </Stack>
      </SectionCard>

      <SectionCard title={(currentRole === 'admin' || currentRole === 'manager') ? 'All Leave Requests' : 'Your Leave Requests'}>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
        ) : requests.length === 0 ? (
          <Typography color="text.secondary">No leave requests found.</Typography>
        ) : (
          <List>
            {requests.map((r) => (
              <React.Fragment key={r.id}>
                <ListItem alignItems="flex-start">
                  <ListItemText
                    primary={`${r.type} — ${r.startDate} to ${r.endDate}`}
                    secondary={
                      <>
                        <div>{r.reason}</div>
                        <div style={{ marginTop: 6 }}>Requester: <strong>{r.displayName || r.userUID}</strong></div>
                        <div style={{ marginTop: 6 }}>Status: <strong>{r.status}</strong>{r.reviewedBy ? ` — Reviewed by ${r.reviewedBy}` : ''}</div>
                      </>
                    }
                  />

                  {/* Manager actions */}
                  {(currentRole === 'admin' || currentRole === 'manager') && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Button size="small" variant="contained" onClick={() => updateStatus(r.id, 'Approved')} disabled={r.status === 'Approved'}>Approve</Button>
                      <Button size="small" variant="outlined" color="error" onClick={() => updateStatus(r.id, 'Rejected')} disabled={r.status === 'Rejected'}>Reject</Button>
                    </Box>
                  )}
                </ListItem>
                <Divider />
              </React.Fragment>
            ))}
          </List>
        )}
      </SectionCard>
    </Box>
  );
};

export default LeaveManagement;
