require "test_helper"

class SyncModeTest < ActiveSupport::TestCase
  test "active? is false by default" do
    refute SyncMode.active?
  end

  test "with_active enables flag during block" do
    observed = nil

    SyncMode.with_active do
      observed = SyncMode.active?
    end

    assert_equal true, observed
    refute SyncMode.active?
  end

  test "with_active restores previous state after exception" do
    assert_raises(RuntimeError) do
      SyncMode.with_active do
        raise "boom"
      end
    end

    refute SyncMode.active?
  end

  test "with_active preserves nested state" do
    outer = nil
    inner = nil

    SyncMode.with_active do
      outer = SyncMode.active?
      SyncMode.with_active do
        inner = SyncMode.active?
      end
      assert SyncMode.active?
    end

    assert_equal true, outer
    assert_equal true, inner
    refute SyncMode.active?
  end
end
