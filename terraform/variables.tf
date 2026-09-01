variable "aws_region" {
  type        = string
  description = "AWS region for all resources."
  default     = "ca-central-1"
}

variable "name" {
  type        = string
  description = "Name prefix for AWS resources."
  default     = "dxl-word-grid"
}

variable "vpc_id" {
  type        = string
  description = "VPC that already exists in the account."
}

variable "public_subnet_ids" {
  type        = list(string)
  description = "At least two public subnets for the load balancer."
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Subnets for the Fargate task. Use public subnets and set assign_public_ip if you have no NAT."
}

variable "assign_public_ip" {
  type        = bool
  description = "Give the task a public IP so it can pull from ECR without NAT."
  default     = true
}

variable "certificate_arn" {
  type        = string
  description = "ACM certificate in this region. Empty keeps HTTP only."
  default     = ""
}

variable "hosted_zone_id" {
  type        = string
  description = "Optional Route 53 zone for a friendly hostname."
  default     = ""
}

variable "dns_name" {
  type        = string
  description = "Hostname in the zone, e.g. word-grid.example.ca. Requires hosted_zone_id."
  default     = ""
}

variable "public_url" {
  type        = string
  description = "Exact public origin used in QR codes, e.g. https://word-grid.example.ca. No trailing slash."
}

variable "image_tag" {
  type        = string
  description = "ECR image tag to run."
  default     = "latest"
}

variable "container_port" {
  type        = number
  default     = 5173
}

variable "cpu" {
  type        = number
  default     = 256
}

variable "memory" {
  type        = number
  default     = 512
}

variable "desired_count" {
  type        = number
  description = "Keep at 1. Rooms live in process memory."
  default     = 1
}

variable "allowed_cidrs" {
  type        = list(string)
  description = "Who can reach the load balancer."
  default     = ["0.0.0.0/0"]
}
