from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
    openai_email_agent_model: str = Field(default="gpt-5.2", alias="OPENAI_EMAIL_AGENT_MODEL")

    imap_host: str = Field(default="", alias="IMAP_HOST")
    imap_port: int = Field(default=993, alias="IMAP_PORT")
    imap_username: str = Field(default="", alias="IMAP_USERNAME")
    imap_password: str = Field(default="", alias="IMAP_PASSWORD")
    imap_use_ssl: bool = Field(default=True, alias="IMAP_USE_SSL")
    imap_default_mailbox: str = Field(default="INBOX", alias="IMAP_DEFAULT_MAILBOX")


settings = Settings()
