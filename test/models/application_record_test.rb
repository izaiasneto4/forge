require "test_helper"

class ApplicationRecordTest < ActiveSupport::TestCase
  test "is an abstract class" do
    assert ApplicationRecord.abstract_class?
  end

  test "inherits from active record base" do
    assert ApplicationRecord < ActiveRecord::Base
  end
end
