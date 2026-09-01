output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}

output "alb_dns_name" {
  value = aws_lb.app.dns_name
}

output "public_url" {
  value = var.public_url
}

output "health_url" {
  value = "${trimsuffix(var.public_url, "/")}/health"
}
