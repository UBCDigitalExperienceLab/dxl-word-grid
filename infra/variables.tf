variable "aws_region" {
  type    = string
  default = "ca-central-1"
}

variable "aws_profile" {
  type    = string
  default = "dev"
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "name_prefix" {
  type    = string
  default = "dxl-word-grid-dev"
}

variable "public_url" {
  type        = string
  default     = ""
  description = "Public base URL of the deployed frontend (GitHub Pages), used to build join links. No trailing slash."
}
