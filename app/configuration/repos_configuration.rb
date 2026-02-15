class ReposConfiguration
  KEY = "repos_folder".freeze

  def folder
    Setting.find_by(key: KEY)&.value
  end

  def folder=(path)
    setting = Setting.find_or_initialize_by(key: KEY)
    setting.update!(value: path)
  end
end
