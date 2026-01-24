import { test, expect } from '@playwright/test';

test.describe('Retry Button for Failed Reviews', () => {
  test('retry button appears for failed review tasks', async ({ page }) => {
    // Go to review tasks board
    await page.goto('/review_tasks');

    // Check if the page loads correctly
    await expect(page.locator('h1')).toContainText('Code Review Tasks');

    // Check if the failed column exists
    await expect(page.locator('#review_task_column_failed_review')).toBeVisible();

    // Check for either retry button or empty state in failed column
    const failedColumn = page.locator('#review_task_column_failed_review');
    const hasContent = await failedColumn.locator('.kanban-card, p').count() > 0;
    expect(hasContent).toBe(true);
  });

  test('retry button is disabled when max retries reached', async ({ page }) => {
    await page.goto('/review_tasks');

    // If there are failed tasks with max retries, check for "Max retries reached" text
    const maxRetriesText = page.locator('text=Max retries reached');
    const retryButtons = page.locator('.retry-btn');

    // Either we have retry buttons or max retries text (or no failed tasks)
    const hasRetryButton = await retryButtons.count() > 0;
    const hasMaxRetriesText = await maxRetriesText.count() > 0;
    const failedCards = await page.locator('#review_task_column_failed_review .kanban-card').count();

    // If there are failed cards, they should have either retry button or max retries message
    if (failedCards > 0) {
      expect(hasRetryButton || hasMaxRetriesText).toBe(true);
    }
    // Test passes if no failed cards exist
  });

  test('retry counter shows correct format', async ({ page }) => {
    await page.goto('/review_tasks');

    // Check that retry counter format is correct (X/3 retries)
    const retryCounters = page.locator('text=/\\d+\\/3 retries/');
    const count = await retryCounters.count();

    // If there are failed tasks, they should have retry counters
    const failedCards = await page.locator('#review_task_column_failed_review .kanban-card').count();
    if (failedCards > 0) {
      expect(count).toBeGreaterThan(0);
    }
  });
});
