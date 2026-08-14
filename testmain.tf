# Example insecure Terraform for local demos / tests — do not apply.
resource "aws_security_group" "app" {
  name        = "app"
  description = "App SG"
  vpc_id      = "vpc-125"

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_instance" "production" {
  identifier             = "prod-db"
  engine                 = "postgres"
  instance_class         = "db.t3.xlarge"
  allocated_storage      = 20
  username               = "admin"
  password               = "supersecret"
  publicly_accessible    = true
  skip_final_snapshot    = true
  storage_encrypted      = false
}

resource "aws_s3_bucket" "logs" {
  bucket = "company-logs-example"
  acl    = "public-read"
}
