# Testing Review State Auto-Update

## Quick Diagnostic Test

### Test 1: Verify Drag-and-Drop Works

1. Open review tasks board: `/review_tasks`
2. Open browser DevTools → Console
3. Drag a card from one column to another
4. Check console for:
   - Fetch request to `/review_tasks/:id/update_state`
   - Response with turbo stream HTML
   - Any JavaScript errors

**Expected**: Card should move immediately without page refresh

**If it doesn't work**: The JavaScript `Turbo.renderStreamMessage` call isn't working

### Test 2: Manual Turbo Stream Test

1. Open review tasks board
2. Open DevTools → Console
3. Run this code:
```javascript
// Test if Turbo can manually render a stream
const stream = `
  <turbo-stream action="update" target="review_task_count_pending_review">
    <template>999</template>
  </turbo-stream>
`
Turbo.renderStreamMessage(stream)
```

4. Check if the "Need to Review" count badge changes to "999"

**Expected**: Count should update to 999

**If it doesn't**: Turbo isn't properly initialized or there's an ID mismatch
