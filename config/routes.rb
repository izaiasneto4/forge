Rails.application.routes.draw do
  mount ActionCable.server => "/cable"

  namespace :api do
    namespace :v1 do
      get :bootstrap, to: "bootstrap#show"
      post :sync, to: "syncs#create"
      post :reviews, to: "reviews#create"
      get :status, to: "status#index"
      get :pull_requests, to: "pull_requests#index"

      resources :pull_requests, only: [] do
        collection do
          get :board
          post :sync
          patch :review_scope
          delete :bulk_destroy
        end

        member do
          patch :status, action: :update_status
          patch :archive
          patch :unarchive
          post :review_task, action: :create_review_task, controller: "pull_requests"
        end
      end

      resources :review_tasks, only: [ :show ] do
        collection do
          get :board
        end

        member do
          patch :state, action: :update_state
          post :retry
          delete :dequeue
          delete :clear
          patch :archive
          patch :unarchive
          post :submissions, to: "review_task_submissions#create"
        end
      end

      get "review_tasks/:id/logs", to: "review_task_logs#show"

      resources :review_comments, only: [] do
        member do
          patch :toggle
        end
      end

      resources :repositories, only: [ :index ] do
        collection do
          post :switch, action: :create
        end
      end

      resource :settings, only: [ :show, :update ] do
        patch :theme
        post :pick_folder
      end
    end
  end

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  get "up" => "rails/health#show", as: :rails_health_check

  root "frontend#index"
  get "/review_tasks", to: "frontend#index"
  get "/review_tasks/:id", to: "frontend#index"
  get "/repositories", to: "frontend#index"
  get "/settings", to: "frontend#index"
end
