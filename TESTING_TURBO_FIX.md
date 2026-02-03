# Turbo Auto-Update Fix - Testing Guide

## Problem Summary
The application was not automatically updating the task board UI when ReviewTask states changed via background jobs. Users had to manually refresh the page to see tasks move between columns.

## Root Cause
**Broadcast timing issue**: The `broadcast_state_change` method was being called **immediately after `update!`**, which executed **before the database transaction committed**. This caused:

1. **Race condition**: Broadcasts fired before DB commit → queries in rendered partials returned stale data
2. **No transaction safety**: If transaction rolled back, broadcast still happened
3. **Missing updates**: Background jobs (ReviewTaskJob) changing states didn't trigger any UI updates

## Fix Applied

### 1. Added `after_commit` Callback
**File**: `app/models/review_task.rb`

**Change**: Added callback that only broadcasts when state changes AND after DB commit:
```ruby
after_commit :broadcast_state_change, if: :saved_change_to_state?
```

### 2. Removed Manual Broadcast Calls
**Files**: `app/models/review_task.rb`

**Changed methods** (removed `broadcast_state_change` calls):
- `start_review!` - Transitions pending_review → in_review
- `complete_review!` - Transitions in_review → reviewed
- `mark_waiting_implementation!` - Transitions reviewed → waiting_implementation
- `mark_done!` - Transitions waiting_implementation → done
- `mark_failed!` - Transitions any → failed_review
- `retry_review!` - Transitions failed_review → pending_review

**Why**: The `after_commit` callback now handles ALL state changes automatically.

## Testing Instructions

### Prerequisites
1. Start the Rails server: `bin/dev`
2. Ensure you have at least one PR in the system
3. Open two browser windows side-by-side:
   - Window A: Review Tasks board (`/review_tasks`)
   - Window B: Pull Requests board (`/pull_requests`)

### Test Case 1: Background Job State Transition (PRIMARY FIX)
**Goal**: Verify tasks automatically move columns when background job changes state

**Steps**:
1. In Window B, click "Review" button on a PR
2. Observe in Window A: Task card should **immediately appear** in "Need to Review" column
3. Wait 2-3 seconds for ReviewTaskJob to start
4. Observe in Window A: Task card should **automatically move** to "In Review" column without page refresh
5. Wait for review job to complete (~30-60 seconds)
6. Observe in Window A: Task card should **automatically move** to "Reviewed" column

**Expected Result**:
- ✅ Task appears immediately when Review clicked
- ✅ Task auto-moves to "In Review" when job starts
- ✅ Task auto-moves to "Reviewed" when job completes
- ✅ Column counts update automatically
- ✅ Empty state messages show/hide correctly
- ❌ **NO manual page refresh needed**

### Test Case 2: Manual Drag-and-Drop (REGRESSION TEST)
**Goal**: Ensure drag-and-drop still works after callback change

**Steps**:
1. In Window A (Review Tasks board), find a task in "Reviewed" column
2. Drag it to "Waiting Implementation" column
3. Release the card
4. Observe: Confirmation modal appears (backward movement warning)
5. Click "Continue"
6. Observe: Card moves to "Waiting Implementation", counts update

**Expected Result**:
- ✅ Drag-and-drop still functions
- ✅ Card moves to correct column
- ✅ Counts update
- ✅ Confirmation works for backward movements

### Test Case 3: Multiple Viewers (REAL-TIME SYNC)
**Goal**: Verify multiple users see updates simultaneously

**Steps**:
1. Open Window A: Review Tasks board
2. Open Window C (new tab): Review Tasks board
3. In Window B, click "Review" on a PR
4. Observe both Window A and C: Both should show task appear in "Need to Review"
5. Wait for job to start
6. Observe both Window A and C: Both should show task move to "In Review"

**Expected Result**:
- ✅ Both viewers see updates in real-time
- ✅ No user needs to refresh

### Test Case 4: Failed Review with Retry
**Goal**: Verify failed → pending transition broadcasts correctly

**Steps**:
1. Manually trigger a review failure (or wait for one to occur)
2. Observe: Task moves to "Failed Review" column automatically
3. Click "Retry" button on the failed task
4. Observe: New task appears in "Need to Review" column
5. Wait for job to start
6. Observe: Task moves to "In Review" column

**Expected Result**:
- ✅ Failed tasks appear in correct column
- ✅ Retry creates new task in "Need to Review"
- ✅ Retry task auto-moves through states

### Test Case 5: Empty Column Messages
**Goal**: Verify empty state messages toggle correctly

**Steps**:
1. Find a column with only 1 task
2. Drag that task to another column
3. Observe: "No [state] tasks" message appears
4. Drag a task back to that column
5. Observe: Message disappears

**Expected Result**:
- ✅ Empty messages appear when column becomes empty
- ✅ Empty messages hide when column gets a task

## Browser DevTools Verification

### Check Action Cable Connection
1. Open DevTools → Console
2. Look for: `[ActionCable] Websocket connected`
3. If missing, check server logs for cable connection

### Monitor Turbo Streams
1. Open DevTools → Console
2. Run:
   ```javascript
   document.addEventListener('turbo:before-stream-render', (event) => {
     console.log('Turbo stream received:', event.detail);
   });
   ```
3. Trigger a state change (click Review button)
4. Check console for turbo stream events

### Verify WebSocket Traffic
1. Open DevTools → Network → WS (WebSocket) tab
2. Click on ActionCable connection
3. In "Messages" panel, watch for:
   - Subscriptions: `{"command":"subscribe","identifier":"{\"channel\":\"Turbo::StreamsChannel\",\"signed_stream_name\":\"...\"}"}`
   - Broadcasts: Messages containing turbo stream HTML

## Common Issues & Solutions

### Issue: No auto-updates happening
**Check**:
1. Server logs show: `Turbo::StreamsChannel broadcasting to review_tasks_board`
2. Browser DevTools → Network → WS shows messages
3. Page has `<%= turbo_stream_from "review_tasks_board" %>` (check view source)

**Solution**: Restart server with `bin/dev`

### Issue: Updates delayed by 5-10 seconds
**Cause**: Background job queue processing delay
**Solution**: Normal behavior, Solid Queue processes jobs asynchronously

### Issue: Card appears in wrong column
**Check**:
1. Database state: `rails console` → `ReviewTask.last.state`
2. Broadcast partial is rendering correct state
3. DOM IDs match: `review_task_column_#{state}`

### Issue: Empty messages not hiding
**Check**:
1. Count queries in broadcast partial are correct
2. `_empty_state.html.erb` partial has correct logic
3. CSS `hidden` class is defined

## Rollback Plan

If issues occur, revert these commits:
1. Callback addition in `app/models/review_task.rb`
2. Broadcast call removals in state transition methods
3. Broadcast partial creation

Or disable auto-updates by commenting out:
```ruby
# app/models/review_task.rb
# after_commit :broadcast_state_change, if: :saved_change_to_state?
```

## Performance Notes

- Each broadcast recalculates all 6 column counts (6 DB queries)
- Acceptable for <100 concurrent tasks
- If board has 1000+ tasks, consider:
  - Caching column counts
  - Only updating affected columns
  - Debouncing rapid state changes

## Files Changed

1. `app/models/review_task.rb` - Added callback, removed manual broadcasts
2. `app/views/review_tasks/_state_change_broadcast.turbo_stream.erb` - Already existed (previous work)
3. `app/views/review_tasks/index.html.erb` - Already had `turbo_stream_from` (previous work)
4. `app/views/review_tasks/create.turbo_stream.erb` - Already updated (previous work)
5. `app/views/review_tasks/update_state.turbo_stream.erb` - Already updated (previous work)

## Success Criteria

✅ Tasks automatically move between columns when state changes
✅ No manual page refresh required
✅ Multiple viewers see updates simultaneously
✅ Column counts update in real-time
✅ Empty state messages toggle correctly
✅ Drag-and-drop still works (regression test passes)
✅ Background job transitions trigger broadcasts
✅ Broadcasts only fire after DB commit (transaction-safe)
