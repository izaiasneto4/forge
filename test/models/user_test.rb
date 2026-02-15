require "test_helper"

class UserTest < ActiveSupport::TestCase
  test "user has default role" do
    user = User.new(email: "test@example.com", password: "password")
    assert_equal "user", user.role
  end

  test "admin? returns true for admin role" do
    admin = users(:admin)
    assert admin.admin?
  end

  test "admin? returns false for user role" do
    user = users(:user)
    assert_not user.admin?
  end

  test "user role enum values are valid" do
    user = users(:user)
    assert_equal "user", user.role
    assert user.user?
    assert_not user.admin?
  end

  test "admin role enum values are valid" do
    admin = users(:admin)
    assert_equal "admin", admin.role
    assert admin.admin?
    assert_not admin.user?
  end

  test "user requires email" do
    user = User.new(password: "password")
    assert_not user.valid?
    assert_includes user.errors[:email], "can't be blank"
  end

  test "user requires password" do
    user = User.new(email: "test@example.com", password: "")
    assert_not user.valid?
    # Devise validates password presence
  end

  test "user email must be unique" do
    existing_user = users(:user)
    duplicate_user = User.new(email: existing_user.email, password: "password")
    assert_not duplicate_user.valid?
    assert_includes duplicate_user.errors[:email], "has already been taken"
  end

  test "user can be created with valid attributes" do
    user = User.new(
      email: "newuser@example.com",
      password: "password123",
      role: "user"
    )
    assert user.valid?
  end

  test "admin can be created with valid attributes" do
    admin = User.new(
      email: "newadmin@example.com",
      password: "password123",
      role: "admin"
    )
    assert admin.valid?
  end

  test "role has default value" do
    user = User.new(email: "test@example.com", password: "password")
    assert_equal "user", user.role
  end

  test "Devise modules are included" do
    user = User.new
    assert_respond_to user, :valid_password?
    assert_respond_to user, :remember_me
  end
end
