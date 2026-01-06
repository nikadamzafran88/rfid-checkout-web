import React, { useEffect, useState } from 'react';
import { Box, Typography, Button, List, ListItem, ListItemText, Divider, CircularProgress, Alert } from '@mui/material';
import { collection, doc, setDoc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/ui/PageHeader';
import SectionCard from '../components/ui/SectionCard';

const StaffAttendance = () => {
  const { currentUser, currentRole } = useAuth();
  const [todayRecord, setTodayRecord] = useState(null);
  const [todayList, setTodayList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const loadData = async () => {
    if (!currentUser) return;
    setLoading(true);
    setMessage('');
    try {
      // Load current user's today's attendance (use deterministic doc id)
      const myDocId = `${currentUser.uid}_${today}`;
      const myRef = doc(db, 'attendance', myDocId);
      const mySnap = await getDoc(myRef);
      setTodayRecord(mySnap.exists() ? mySnap.data() : null);

      // If manager or admin, load all today's attendance
      if (currentRole === 'admin' || currentRole === 'manager') {
        const q = query(collection(db, 'attendance'), where('date', '==', today));
        const snap = await getDocs(q);
        let list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        // Resolve user names for the list
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
            console.error('Failed to fetch user for attendance display:', err);
            nameMap[uid] = uid;
          }
        }));

        list = list.map((r) => ({ ...r, displayName: nameMap[r.userUID] || r.userUID }));
        setTodayList(list);
      } else {
        setTodayList([]);
      }
    } catch (err) {
      console.error('Failed to load attendance:', err);
      setMessage('Failed to load attendance. Check console for details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, currentRole]);

  const handleCheckIn = async () => {
    if (!currentUser) {
      setMessage('You must be signed in to check in.');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const id = `${currentUser.uid}_${today}`;
      const ref = doc(db, 'attendance', id);
      const userDisplayName = currentUser.displayName || currentUser.fullName || currentUser.email || currentUser.uid;
      await setDoc(ref, {
        userUID: currentUser.uid,
        userDisplayName,
        date: today,
        checkInTime: new Date().toISOString(),
        status: 'Present',
      }, { merge: true });
      setMessage('Checked in successfully.');
      await loadData();
    } catch (err) {
      console.error('Check-in failed:', err);
      setMessage('Check-in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckOut = async () => {
    if (!currentUser) {
      setMessage('You must be signed in to check out.');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const id = `${currentUser.uid}_${today}`;
      const ref = doc(db, 'attendance', id);
      const userDisplayName = currentUser.displayName || currentUser.fullName || currentUser.email || currentUser.uid;
      await setDoc(ref, {
        userDisplayName,
        checkOutTime: new Date().toISOString(),
      }, { merge: true });
      setMessage('Checked out successfully.');
      await loadData();
    } catch (err) {
      console.error('Check-out failed:', err);
      setMessage('Check-out failed.');
    } finally {
      setLoading(false);
    }
  };

  const fmtTime = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleTimeString();
    } catch {
      return iso;
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader title="Staff Attendance" subtitle="Check in/out and review today's attendance." />

      {message && <Alert severity="info" sx={{ mb: 2 }}>{message}</Alert>}

      {!currentUser ? (
        <SectionCard>
          <Typography>Please sign in to check in or check out.</Typography>
        </SectionCard>
      ) : (
        <SectionCard title={`Today's Attendance (${today})`} sx={{ mb: 3 }}>
          <Typography sx={{ mb: 1, fontWeight: 600 }}>Today's Attendance ({today})</Typography>

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
          ) : (
            <>
              <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                <Button variant="contained" onClick={handleCheckIn} disabled={!!todayRecord?.checkInTime}>
                  {todayRecord?.checkInTime ? 'Checked In' : 'Check In'}
                </Button>
                <Button variant="outlined" onClick={handleCheckOut} disabled={!todayRecord?.checkInTime || !!todayRecord?.checkOutTime}>
                  {todayRecord?.checkOutTime ? 'Checked Out' : 'Check Out'}
                </Button>
              </Box>

              <List>
                <ListItem>
                  <ListItemText primary="Check-in time" secondary={fmtTime(todayRecord?.checkInTime)} />
                </ListItem>
                <Divider />
                <ListItem>
                  <ListItemText primary="Check-out time" secondary={fmtTime(todayRecord?.checkOutTime)} />
                </ListItem>
              </List>
            </>
          )}
        </SectionCard>
      )}

      {/* Manager/Admin view: all today's attendance */}
      {(currentRole === 'admin' || currentRole === 'manager') && (
        <SectionCard title="All Attendance Today">
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
          ) : todayList.length === 0 ? (
            <Typography color="text.secondary">No attendance records for today.</Typography>
          ) : (
            <List>
              {todayList.map((rec) => (
                <ListItem key={rec.id} divider>
                  <ListItemText
                    primary={rec.displayName || rec.userDisplayName || rec.userUID}
                    secondary={`In: ${fmtTime(rec.checkInTime)} — Out: ${fmtTime(rec.checkOutTime)} | status: ${rec.status || '—'}`}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </SectionCard>
      )}
    </Box>
  );
};

export default StaffAttendance;
