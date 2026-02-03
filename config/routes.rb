Rails.application.routes.draw do
  resources :pull_requests, only: [ :index ] do
    collection do
      post :sync
      post :async_sync
      delete :bulk_destroy
    end
    member do
      patch :update_status
    end
  end

  resources :review_tasks, only: [ :index, :show, :create ] do
    member do
      patch :update_state
      post :retry
      delete :dequeue
    end
    resources :review_comments, only: [] do
      collection do
        post :submit
      end
    end
  end

  resources :review_comments, only: [] do
    member do
      patch :toggle
    end
  end

  resources :repositories, only: [ :index ] do
    collection do
      post :switch
      get :list
    end
  end

  resource :settings, only: [ :edit, :update ] do
    post :pick_folder, on: :collection
  end

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  get "up" => "rails/health#show", as: :rails_health_check

  root "pull_requests#index"
end
